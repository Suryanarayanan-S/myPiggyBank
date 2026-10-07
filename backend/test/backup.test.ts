import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, resetDb } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = (script: string, args: string[]) =>
  spawnSync('node', [path.join(root, 'scripts', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, RESTORE_CHECK_PORTS: '' },
  });
const familiesIn = async (file: string) => {
  const db = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    return (await db.family.findMany({ select: { name: true } })).map((f) => f.name);
  } finally {
    await db.$disconnect();
  }
};

describe('backup and restore scripts', () => {
  let dir: string;
  let source: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-backup-'));
    await resetDb();
    await prisma.family.create({ data: { name: 'Backup family' } });
    source = path.join(dir, 'piggybank.db');
    await prisma.$executeRawUnsafe(`VACUUM INTO '${source}'`);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('backs up a consistent copy with a timestamped name', async () => {
    const out = path.join(dir, 'backups');
    const res = run('backup.mjs', ['--db', source, '--out', out]);
    expect(res.status, res.stderr).toBe(0);
    const files = fs.readdirSync(out).filter((f) => /^piggybank-\d{8}-\d{6}\.db$/.test(f));
    expect(files).toHaveLength(1);
    expect(await familiesIn(path.join(out, files[0]!))).toEqual(['Backup family']);
  });

  it('restores a backup over the database and keeps a safety copy of the replaced one', async () => {
    const out = path.join(dir, 'restore-backups');
    run('backup.mjs', ['--db', source, '--out', out]);
    const backup = path.join(out, fs.readdirSync(out)[0]!);
    const target = path.join(dir, 'target.db');
    fs.copyFileSync(source, target);
    const t = new PrismaClient({ datasourceUrl: `file:${target}` });
    await t.family.updateMany({ data: { name: 'Changed later' } });
    await t.$disconnect();

    const res = run('restore.mjs', [backup, '--db', target, '--out', out]);
    expect(res.status, res.stderr).toBe(0);
    expect(await familiesIn(target)).toEqual(['Backup family']);
    const safety = fs.readdirSync(out).find((f) => f.startsWith('before-restore-'));
    expect(safety).toBeDefined();
    expect(await familiesIn(path.join(out, safety!))).toEqual(['Changed later']);
  });

  it.each([
    ['not a database', (f: string) => fs.writeFileSync(f, 'hello')],
    [
      'an SQLite file from something else',
      async (f: string) => {
        const other = new PrismaClient({ datasourceUrl: `file:${f}` });
        await other.$executeRawUnsafe('CREATE TABLE notes (id INTEGER)');
        await other.$disconnect();
      },
    ],
  ])('refuses to restore %s and leaves the database untouched', async (_label, make) => {
    const bad = path.join(dir, `bad-${Math.random().toString(36).slice(2)}.db`);
    await make(bad);
    const target = path.join(dir, 'untouched.db');
    fs.copyFileSync(source, target);
    const res = run('restore.mjs', [bad, '--db', target, '--out', path.join(dir, 'x')]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/not a myPiggyBank backup/);
    expect(await familiesIn(target)).toEqual(['Backup family']);
  });

  it('refuses to restore while the app is running', async () => {
    const net = await import('node:net');
    const server = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    const res = spawnSync(
      'node',
      [path.join(root, 'scripts', 'restore.mjs'), source, '--db', path.join(dir, 'y.db')],
      {
        encoding: 'utf8',
        env: { ...process.env, RESTORE_CHECK_PORTS: String(port) },
      },
    );
    server.close();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/still running/);
  });
});

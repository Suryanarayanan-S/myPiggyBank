#!/usr/bin/env node
// Restores a myPiggyBank backup. Stop the app first (docker compose stop / Ctrl+C on npm run dev).
// Usage: npm run restore -- backups/piggybank-20261007-153012.db [--db data/piggybank.db] [--force]
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// Flags that take a value; --force takes none, so a file may follow it.
const WITH_VALUE = new Set(['--db', '--out']);
const backup = args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.has(args[i - 1]));
if (!backup) fail('Usage: npm run restore -- <backup file> [--db data/piggybank.db]');
const source = path.resolve(backup);
const db = path.resolve(arg('db') ?? path.join(root, 'data/piggybank.db'));
const out = path.resolve(arg('out') ?? path.join(root, 'backups'));
if (!fs.existsSync(source)) fail(`No such file: ${source}`);

// 1. Refuse while the app is running (it would keep writing to the old file).
const ports = (process.env.RESTORE_CHECK_PORTS ?? '8080,3001')
  .split(',')
  .filter(Boolean)
  .map(Number);
const isOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });
if (!args.includes('--force')) {
  for (const port of ports) {
    if (await isOpen(port)) {
      fail(
        `The app is still running (port ${port}). Stop it first: "docker compose stop" or Ctrl+C on "npm run dev".`,
      );
    }
  }
}

// 2. Check the file really is a myPiggyBank database.
const check = new PrismaClient({ datasourceUrl: `file:${source}` });
let ok = false;
let damaged = false;
try {
  const tables = await check.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table'`);
  const names = new Set(tables.map((t) => t.name));
  ok = names.has('_prisma_migrations') && names.has('Family') && names.has('Transaction');
  if (ok) {
    const [result] = await check.$queryRawUnsafe('PRAGMA quick_check');
    damaged = Object.values(result ?? {})[0] !== 'ok';
  }
} catch {
  ok = false;
} finally {
  await check.$disconnect();
}
if (!ok) fail(`${source} is not a myPiggyBank backup. Nothing was changed.`);
if (damaged) fail(`${source} is damaged (integrity check failed). Nothing was changed.`);

// 3. Keep the current database, then put the backup in its place.
fs.mkdirSync(out, { recursive: true });
if (fs.existsSync(db)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const safety = path.join(out, `before-restore-${stamp}.db`);
  const current = new PrismaClient({ datasourceUrl: `file:${db}` });
  try {
    await current.$executeRawUnsafe(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);
  } finally {
    await current.$disconnect();
  }
  console.log(`Previous database kept at ${safety}`);
}
// Copy next to the target first, then swap in one step: never a half-written database.
const incoming = `${db}.restoring`;
fs.copyFileSync(source, incoming);
for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(db + suffix, { force: true });
fs.renameSync(incoming, db);
console.log(
  `Restored ${source} → ${db}. Start the app again (docker compose start / npm run dev).`,
);

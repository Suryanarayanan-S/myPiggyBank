#!/usr/bin/env node
// Consistent backup of a myPiggyBank SQLite database (safe while the app is running).
// Usage: npm run backup [-- --db data/piggybank.db --out backups/]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const db = path.resolve(arg('db') ?? path.join(root, 'data/piggybank.db'));
const out = path.resolve(arg('out') ?? path.join(root, 'backups'));
const KEEP = 20;
if (!fs.existsSync(db)) fail(`No database at ${db}`);
fs.mkdirSync(out, { recursive: true });

const name = path.basename(db, '.db');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const target = path.join(out, `${name}-${stamp}.db`);

const prisma = new PrismaClient({ datasourceUrl: `file:${db}` });
try {
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} catch (e) {
  fail(`Backup failed: ${e.message}`);
} finally {
  await prisma.$disconnect();
}

// Keep the newest backups made by this script; never touch other files.
const own = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}-\\d{6}\\.db$`);
const old = fs
  .readdirSync(out)
  .filter((f) => own.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) fs.rmSync(path.join(out, f));

const mb = (fs.statSync(target).size / 1e6).toFixed(2);
console.log(`Backup written: ${target} (${mb} MB)`);

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(dir, '.tmp/test.db');

export default function setup() {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
  execSync('npx prisma migrate deploy', {
    cwd: path.join(dir, '..'),
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  });
}

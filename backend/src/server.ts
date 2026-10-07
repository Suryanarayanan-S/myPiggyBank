import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { generateDue } from './services/recurringService.js';

const config = loadConfig();
const prisma = new PrismaClient();
await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');

const frontendDist =
  config.NODE_ENV === 'production'
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
    : undefined;

const app = await buildApp({ prisma, config, logger: true, frontendDist });

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });

// Recurring transactions: create everything due now, then check again every hour.
const runRecurring = () =>
  generateDue(prisma, new Date().toISOString().slice(0, 10))
    .then(({ created }) => created && app.log.info({ created }, 'recurring transactions created'))
    .catch((err) => app.log.error(err, 'recurring generation failed'));
await runRecurring();
setInterval(runRecurring, 60 * 60 * 1000).unref();

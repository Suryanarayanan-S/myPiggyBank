import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

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

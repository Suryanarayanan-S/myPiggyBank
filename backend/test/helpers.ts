import { PrismaClient } from '@prisma/client';
import { buildApp, type AppOptions } from '../src/app.js';

export const prisma = new PrismaClient();

export const testConfig = { COOKIE_SECURE: false, ALLOW_REGISTRATION: true, SESSION_DAYS: 30 };

export function makeApp(overrides: Partial<AppOptions> = {}) {
  return buildApp({ prisma, config: testConfig, logger: false, ...overrides });
}

/** Every domain table cascades from Family, so deleting families empties the DB. */
export async function resetDb() {
  await prisma.family.deleteMany();
}

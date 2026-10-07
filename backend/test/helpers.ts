import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
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

export async function signUp(
  app: FastifyInstance,
  overrides: Partial<{ name: string; email: string; password: string; familyName: string }> = {},
) {
  const payload = {
    name: 'Test User',
    email: `user-${randomUUID()}@example.com`,
    password: 'correct-horse-battery',
    ...overrides,
  };
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
  if (res.statusCode !== 201) throw new Error(`signUp failed: ${res.statusCode} ${res.body}`);
  const session = res.cookies.find((c) => c.name === 'pb_session');
  if (!session) throw new Error('signUp: no session cookie');
  return { user: res.json().data.user, cookie: `pb_session=${session.value}`, payload };
}

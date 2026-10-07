import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('auth', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const me = (cookie?: string) =>
    app.inject({ method: 'GET', url: '/api/auth/me', headers: cookie ? { cookie } : {} });

  it('register creates family, owner user and linked member, and starts a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Surya', email: 'surya@example.com', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(201);
    const user = res.json().data.user;
    expect(user).toMatchObject({ name: 'Surya', email: 'surya@example.com', role: 'owner' });
    expect(user).not.toHaveProperty('passwordHash');

    const family = await prisma.family.findUniqueOrThrow({ where: { id: user.familyId } });
    expect(family).toMatchObject({
      name: "Surya's family",
      spendingCurrency: 'EUR',
      wealthCurrency: 'INR',
    });
    const member = await prisma.familyMember.findUniqueOrThrow({ where: { id: user.memberId } });
    expect(member).toMatchObject({ name: 'Surya', userId: user.id });

    const cookie = res.cookies.find((c) => c.name === 'pb_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
  });

  it('stores an argon2id hash, never the password', async () => {
    const { user, payload } = await signUp(app);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain(payload.password);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('normalises email case/whitespace and rejects duplicates differing only by case', async () => {
    const { user } = await signUp(app, { email: '  Surya@Example.COM ' });
    expect(user.email).toBe('surya@example.com');

    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Other', email: 'SURYA@example.com', password: 'another-long-password' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_TAKEN');

    expect((await login('SURYA@EXAMPLE.com', 'correct-horse-battery')).statusCode).toBe(200);
  });

  it('rejects a short password with a VALIDATION_ERROR naming the field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'A', email: 'a@example.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details).toEqual([
      { path: 'password', message: 'Password must be at least 10 characters' },
    ]);
  });

  it('returns 403 when registration is disabled', async () => {
    const closed = await makeApp({
      config: { COOKIE_SECURE: false, ALLOW_REGISTRATION: false, SESSION_DAYS: 30 },
    });
    const res = await closed.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'A', email: 'a@example.com', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('REGISTRATION_DISABLED');
    await closed.close();
  });

  it('login sets a session cookie and /me returns user and family', async () => {
    const { payload } = await signUp(app, { familyName: 'Soundararajan' });
    const res = await login(payload.email, payload.password);
    expect(res.statusCode).toBe(200);
    const value = res.cookies.find((c) => c.name === 'pb_session')!.value;

    const meRes = await me(`pb_session=${value}`);
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().data).toMatchObject({
      user: { email: payload.email },
      family: { name: 'Soundararajan', spendingCurrency: 'EUR', wealthCurrency: 'INR' },
    });
  });

  it('wrong password and unknown email produce the identical 401 body', async () => {
    const { payload } = await signUp(app);
    const wrongPw = await login(payload.email, 'not-the-password');
    const unknown = await login('nobody@example.com', 'not-the-password');
    expect(wrongPw.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual(unknown.json());
    expect(wrongPw.json().error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  });

  it('/me without a cookie or with a garbage cookie is 401 UNAUTHENTICATED', async () => {
    expect((await me()).statusCode).toBe(401);
    const res = await me('pb_session=garbage');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('an expired session is treated as logged out and removed', async () => {
    const { cookie, user } = await signUp(app);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('logout invalidates the session and clears the cookie', async () => {
    const { cookie } = await signUp(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const cleared = res.cookies.find((c) => c.name === 'pb_session');
    expect(cleared?.value).toBe('');
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('rejects text/plain bodies with 415 (CSRF-safe: only JSON is accepted)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'email=a&password=b',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('rate-limits repeated login attempts with 429 RATE_LIMITED', async () => {
    const limited = await makeApp({ loginRateLimit: { max: 3, timeWindow: '1 minute' } });
    const attempt = () =>
      limited.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'x@example.com', password: 'whatever-password' },
      });
    for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
    await limited.close();
  });
});

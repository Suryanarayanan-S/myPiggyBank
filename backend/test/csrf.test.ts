import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, signUp } from './helpers.js';

describe('CSRF protection for state-changing requests', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    ({ cookie } = await signUp(app));
  });
  afterEach(() => app.close());

  const logout = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, ...headers } });
  const me = () => app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });

  it('rejects a POST from another origin (e.g. another app on localhost:9999)', async () => {
    const res = await logout({ host: 'localhost:5173', origin: 'http://localhost:9999' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_REQUEST');
    expect((await me()).statusCode).toBe(200);
  });

  it('rejects requests the browser marks as cross-site or same-site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await logout({ 'sec-fetch-site': site });
      expect(res.statusCode).toBe(403);
    }
    expect((await me()).statusCode).toBe(200);
  });

  it('rejects a cross-origin DELETE', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/members/00000000-0000-4000-8000-000000000000',
      headers: { cookie, host: 'localhost:8080', origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows same-origin requests from the app itself', async () => {
    const res = await logout({
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
      'sec-fetch-site': 'same-origin',
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not restrict safe GET requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(200);
  });
});

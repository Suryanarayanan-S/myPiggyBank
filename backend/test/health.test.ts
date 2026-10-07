import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, testConfig } from './helpers.js';

describe('health & routing', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('GET /api/health reports ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ok' } });
  });

  it('unknown API routes return a JSON 404 in the standard error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('does not force HTTPS upgrades over plain HTTP (COOKIE_SECURE=false)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });

  it('keeps upgrade-insecure-requests when served over HTTPS (COOKIE_SECURE=true)', async () => {
    const secure = await makeApp({ config: { ...testConfig, COOKIE_SECURE: true } });
    const res = await secure.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    await secure.close();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, signUp } from './helpers.js';

describe('family settings', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    ({ cookie } = await signUp(app, { name: 'Surya', familyName: 'Soundararajan' }));
  });
  afterEach(() => app.close());

  it('new families spend in EUR and track wealth in INR', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/family', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      id: expect.any(String),
      name: 'Soundararajan',
      spendingCurrency: 'EUR',
      wealthCurrency: 'INR',
    });
  });

  it('updates name and currencies', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/family',
      headers: { cookie },
      payload: { name: 'S Family', spendingCurrency: 'GBP', wealthCurrency: 'USD' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      name: 'S Family',
      spendingCurrency: 'GBP',
      wealthCurrency: 'USD',
    });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().data.family).toMatchObject({ spendingCurrency: 'GBP', wealthCurrency: 'USD' });
  });

  it('rejects unsupported currencies', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/family',
      headers: { cookie },
      payload: { spendingCurrency: 'JPY' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/family' })).statusCode).toBe(401);
  });
});

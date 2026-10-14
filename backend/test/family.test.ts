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
      rateMode: 'manual',
      targets: { essentials: 50, fun: 30, future: 20 },
      bucketNames: { essentials: 'Keep Me Alive', fun: 'Make Me Happy', future: 'Make Me Rich' },
    });
  });

  it('renames the three buckets', async () => {
    const put = (bucketNames: object) =>
      app.inject({
        method: 'PUT',
        url: '/api/family',
        headers: { cookie },
        payload: { bucketNames },
      });
    const res = await put({ essentials: ' Bills ', fun: 'Treats', future: 'Later' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.bucketNames).toEqual({
      essentials: 'Bills',
      fun: 'Treats',
      future: 'Later',
    });
    expect((await put({ essentials: '', fun: 'Treats', future: 'Later' })).statusCode).toBe(400);
    expect((await put({ essentials: 'Same', fun: 'same', future: 'Later' })).statusCode).toBe(400);
    expect((await put({ essentials: 'x'.repeat(31), fun: 'a', future: 'b' })).statusCode).toBe(400);
    // Names the pages already use for other figures would be confusing.
    expect((await put({ essentials: 'Bills', fun: 'Treats', future: 'spent' })).statusCode).toBe(
      400,
    );
  });

  it('updates the 50/30/20 bucket targets', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/family',
      headers: { cookie },
      payload: { targets: { essentials: 60, fun: 25, future: 15 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.targets).toEqual({ essentials: 60, fun: 25, future: 15 });
  });

  it.each([
    [{ essentials: 50, fun: 30, future: 19 }],
    [{ essentials: 110, fun: -10, future: 0 }],
    [{ essentials: 50.5, fun: 29.5, future: 20 }],
  ])('rejects targets that are not whole percents summing to 100 %#', async (targets) => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/family',
      headers: { cookie },
      payload: { targets },
    });
    expect(res.statusCode).toBe(400);
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

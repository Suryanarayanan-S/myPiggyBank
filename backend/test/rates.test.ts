import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

describe('exchange rates', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
  });
  afterEach(() => app.close());

  const put = (body: object) => call('PUT', '/api/exchange-rates', body);
  const sep = { month: '2026-09', base: 'EUR', quote: 'INR', rate: '97.85' };

  it('creates a monthly rate, then updates the same month and pair', async () => {
    const created = await put(sep);
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toEqual({ id: expect.any(String), ...sep });
    const updated = await put({ ...sep, rate: '98,10' });
    expect(updated.json().data).toMatchObject({ id: created.json().data.id, rate: '98.1' });
    expect((await call('GET', '/api/exchange-rates')).json().data).toHaveLength(1);
  });

  it('lists newest month first', async () => {
    await put({ ...sep, month: '2026-08' });
    await put(sep);
    const months = (await call('GET', '/api/exchange-rates'))
      .json()
      .data.map((r: { month: string }) => r.month);
    expect(months).toEqual(['2026-09', '2026-08']);
  });

  it.each([
    [{ ...sep, rate: '0' }],
    [{ ...sep, rate: 'abc' }],
    [{ ...sep, month: '2026-13' }],
    [{ ...sep, month: '2026-9' }],
    [{ ...sep, quote: 'EUR' }],
    [{ ...sep, base: 'JPY' }],
  ])('rejects invalid input %#', async (body) => {
    expect((await put(body)).statusCode).toBe(400);
  });

  it('deletes a rate; other families get 404', async () => {
    const id = (await put(sep)).json().data.id;
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('DELETE', `/api/exchange-rates/${id}`)).statusCode).toBe(404);
    expect((await other('GET', '/api/exchange-rates')).json().data).toEqual([]);
    expect((await call('DELETE', `/api/exchange-rates/${id}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/exchange-rates')).json().data).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { client, makeApp, resetDb, signUp } from './helpers.js';

const today = todayLocal();
const month = today.slice(0, 7);

describe('insights', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
  });
  afterEach(() => app.close());

  it('collects observations from budget limits, goals and investments', async () => {
    const acc = (
      await call('POST', '/api/accounts', { name: 'Giro', type: 'current', currency: 'EUR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    const groceries = cats.find((c) => c.name === 'Groceries')!.id;
    await call('POST', '/api/transactions', {
      date: `${month}-01`,
      amount: 30_000,
      type: 'expense',
      accountId: acc.id,
      categoryId: groceries,
    });
    await call('PUT', `/api/budget/${month}/limits`, {
      limits: [{ categoryId: groceries, amount: 25_000 }],
    });
    await call('POST', '/api/goals', {
      name: 'House',
      targetAmount: 1_000_000,
      currency: 'EUR',
      targetDate: addDays(today, 200),
    });
    const etf = (
      await call('POST', '/api/holdings', { name: 'ETF', kind: 'etf', currency: 'EUR' })
    ).json().data;
    await call('POST', `/api/holdings/${etf.id}/trades`, {
      date: addDays(today, -40),
      type: 'buy',
      units: '10',
      amount: 100_000,
    });
    await call('POST', `/api/holdings/${etf.id}/prices`, { date: today, price: '120' });

    const res = await call('GET', '/api/insights');
    expect(res.statusCode).toBe(200);
    const { currency, insights } = res.json().data;
    expect(currency).toBe('EUR');
    expect(insights.map((i: { kind: string }) => i.kind)).toEqual(
      expect.arrayContaining(['overLimit', 'goalBehind', 'holding']),
    );
    expect(insights.find((i: { kind: string }) => i.kind === 'overLimit').data).toMatchObject({
      category: 'Groceries',
      over: 5_000,
    });
    expect(insights.at(-1).tone).toBe('good'); // the ETF gain comes last
  });

  it('lists amounts it could not convert', async () => {
    const inr = (
      await call('POST', '/api/accounts', { name: 'ICICI', type: 'savings', currency: 'INR' })
    ).json().data;
    await call('POST', '/api/transactions', {
      date: `${month}-01`,
      amount: 100_000,
      type: 'expense',
      accountId: inr.id,
    });
    const data = (await call('GET', '/api/insights')).json().data;
    expect(data.unconverted).toEqual([{ currency: 'INR', amount: 100_000 }]);
  });

  it('refuses an unknown currency', async () => {
    expect((await call('GET', '/api/insights?currency=XYZ')).statusCode).toBe(400);
  });

  it('spreadsheet rows are monthly totals, not regular single payments', async () => {
    const acc = (
      await call('POST', '/api/accounts', { name: 'Giro', type: 'current', currency: 'EUR' })
    ).json().data;
    const { prisma } = await import('./helpers.js');
    const fam = (await call('GET', '/api/family')).json().data.id;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    const rent = cats.find((c) => c.name === 'Rent')!.id;
    for (const m of [1, 2, 3, 4]) {
      const d = new Date(`${today.slice(0, 4)}-${month.slice(5)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - m);
      await prisma.transaction.create({
        data: {
          familyId: fam,
          accountId: acc.id,
          date: d,
          amount: 91_200,
          type: 'expense',
          merchant: 'Rent',
          categoryId: rent,
          importBatch: `xlsx:${d.toISOString().slice(0, 7)}`,
        },
      });
    }
    const { insights } = (await call('GET', '/api/insights')).json().data;
    expect(insights.map((i: { kind: string }) => i.kind)).not.toContain('subscription');
  });
});

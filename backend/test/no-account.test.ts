import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

async function family(app: FastifyInstance) {
  const call = client(app, (await signUp(app)).cookie);
  const giro = (
    await call('POST', '/api/accounts', {
      name: 'Giro',
      type: 'current',
      currency: 'EUR',
      openingBalance: 100_000,
    })
  ).json().data;
  const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  return { call, giro, cat };
}

describe('transactions without an account', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
  });
  afterEach(() => app.close());

  const cash = (extra: object = {}) =>
    f.call('POST', '/api/transactions', {
      date: '2026-09-12',
      amount: 2_500,
      type: 'expense',
      categoryId: f.cat('Groceries'),
      merchant: 'Market stall',
      accountId: null,
      ...extra,
    });

  it('is saved in the spending currency when none is chosen', async () => {
    const res = await cash();
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      accountId: null,
      accountName: null,
      currency: 'EUR',
      amount: 2_500,
    });
  });

  it('is saved in the currency chosen', async () => {
    const t = (await cash({ currency: 'INR', amount: 150_000 })).json().data;
    expect(t).toMatchObject({ accountId: null, currency: 'INR' });
  });

  it('with an account always uses the account’s currency', async () => {
    const ok = await cash({ accountId: f.giro.id, currency: 'EUR' });
    expect(ok.json().data).toMatchObject({ accountName: 'Giro', currency: 'EUR' });
    const wrong = await cash({ accountId: f.giro.id, currency: 'INR' });
    expect(wrong.statusCode).toBe(400);
    expect(JSON.stringify(wrong.json())).toContain('Giro is in EUR');
  });

  it('an edit must say which account (or none), so leaving it out never detaches one', async () => {
    const t = (await cash({ accountId: f.giro.id })).json().data;
    const res = await f.call('PUT', `/api/transactions/${t.id}`, {
      date: t.date,
      amount: t.amount,
      type: t.type,
    });
    expect(res.statusCode).toBe(400);
  });

  it('a transfer still needs an account to send from', async () => {
    const res = await f.call('POST', '/api/transactions', {
      date: '2026-09-12',
      amount: 2_500,
      type: 'transfer',
      accountId: null,
      transferAccountId: f.giro.id,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('Choose the account sending the money');
  });

  it('does not change any account balance', async () => {
    await cash();
    const [giro] = (await f.call('GET', '/api/accounts')).json().data;
    expect(giro.balance).toBe(100_000);
  });

  it('can be moved to an account and back', async () => {
    const t = (await cash({ currency: 'INR' })).json().data;
    const body = { date: t.date, amount: t.amount, type: t.type, categoryId: t.categoryId };
    const moved = await f.call('PUT', `/api/transactions/${t.id}`, {
      ...body,
      accountId: f.giro.id,
    });
    expect(moved.json().data).toMatchObject({ accountName: 'Giro', currency: 'EUR' });
    const back = await f.call('PUT', `/api/transactions/${t.id}`, { ...body, accountId: null });
    expect(back.json().data).toMatchObject({ accountId: null, currency: 'EUR' });
  });

  it('counts in the budget, the list totals and the dashboard', async () => {
    await cash();
    await cash({ currency: 'INR', amount: 1_000_000 });
    await f.call('PUT', '/api/exchange-rates', {
      month: '2026-09',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    const budget = (await f.call('GET', '/api/budget/2026-09')).json().data;
    expect(budget.essentials).toBe(2_500 + 10_000);

    const list = (
      await f.call('GET', '/api/transactions?from=2026-09-01&to=2026-09-30&currency=EUR')
    ).json().data;
    expect(list.totals).toEqual([
      { currency: 'EUR', income: 0, expense: 2_500 },
      { currency: 'INR', income: 0, expense: 1_000_000 },
    ]);
    expect(list.converted.expense).toBe(12_500);

    const dash = (await f.call('GET', '/api/dashboard?from=2026-09&to=2026-09')).json().data;
    expect(JSON.stringify(dash)).toContain('12500');
  });

  it('the list can show only transactions without an account', async () => {
    await cash();
    await cash({ accountId: f.giro.id });
    const list = (await f.call('GET', '/api/transactions?accountId=none')).json().data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].accountId).toBeNull();
  });

  it('exports with an empty account cell', async () => {
    await cash();
    const res = await f.call('GET', '/api/export/transactions.csv?from=2026-09-01&to=2026-09-30');
    expect(res.body).toContain('2026-09-12;expense;-25,00;EUR;;Groceries;');
  });
});

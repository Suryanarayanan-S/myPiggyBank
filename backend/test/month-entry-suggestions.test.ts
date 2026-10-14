import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('quick entry suggestions', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let eur: { id: string };
  let cat: (n: string) => string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    eur = (
      await call('POST', '/api/accounts', { name: 'Sparkasse', type: 'current', currency: 'EUR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    cat = (n) => cats.find((c) => c.name === n)!.id;
  });
  afterEach(() => app.close());

  const txn = (date: string, category: string, amount: number, extra: object = {}) =>
    call('POST', '/api/transactions', {
      date,
      amount,
      type: category === 'Salary' ? 'income' : 'expense',
      accountId: eur.id,
      categoryId: cat(category),
      ...extra,
    });
  const row = async (month: string, n: string) =>
    (await call('GET', `/api/month-entry/${month}?accountId=${eur.id}`))
      .json()
      .data.rows.find((r: { categoryId: string }) => r.categoryId === cat(n));

  it('offers last month and the usual of the three months before', async () => {
    await txn('2026-06-01', 'Salary', 500_000);
    await txn('2026-06-03', 'Groceries', 30_000);
    await txn('2026-07-01', 'Salary', 500_000); // July: no groceries
    await txn('2026-08-01', 'Salary', 500_000);
    await txn('2026-08-03', 'Groceries', 20_000);
    await txn('2026-08-20', 'Groceries', 10_000, { accountId: null }); // cash counts too
    await txn('2026-08-21', 'Groceries', 99_999, { accountId: null, currency: 'INR' }); // not EUR
    expect(await row('2026-09', 'Groceries')).toMatchObject({ lastMonth: 30_000, usual: 20_000 });
    expect(await row('2026-09', 'Salary')).toMatchObject({ lastMonth: 500_000, usual: 500_000 });
    expect(await row('2026-09', 'Rent')).toMatchObject({ lastMonth: null, usual: null });
  });

  it('months with nothing recorded do not pull the usual down', async () => {
    await txn('2026-08-03', 'Groceries', 20_000);
    expect(await row('2026-09', 'Groceries')).toMatchObject({ lastMonth: 20_000, usual: 20_000 });
    // 2026-08 is two months before October; September is empty, so "last month" has nothing.
    expect(await row('2026-10', 'Groceries')).toMatchObject({ lastMonth: null, usual: 20_000 });
  });

  it('leaves out other accounts’ monthly totals and recurring payments', async () => {
    const other = (
      await call('POST', '/api/accounts', { name: 'Revolut', type: 'current', currency: 'EUR' })
    ).json().data;
    // Each account keeps its own grid: B's total must not be suggested into A's.
    await call('PUT', '/api/month-entry/2026-08', {
      accountId: eur.id,
      entries: [{ categoryId: cat('Groceries'), amount: 30_000 }],
    });
    await call('PUT', '/api/month-entry/2026-08', {
      accountId: other.id,
      entries: [{ categoryId: cat('Groceries'), amount: 20_000 }],
    });
    // A recurring rent is added by itself each month: suggesting it would count it twice.
    const rule = (
      await call('POST', '/api/recurring', {
        name: 'Rent',
        type: 'expense',
        amount: 91_200,
        accountId: eur.id,
        categoryId: cat('Rent'),
        frequency: 'monthly',
        startDate: '2026-12-31',
      })
    ).json().data;
    const rent = (await txn('2026-08-03', 'Rent', 91_200)).json().data;
    await prisma.transaction.update({ where: { id: rent.id }, data: { recurringRuleId: rule.id } });
    expect(await row('2026-09', 'Groceries')).toMatchObject({ lastMonth: 30_000 });
    expect(await row('2026-09', 'Rent')).toMatchObject({ lastMonth: null, usual: null });
  });

  it('only months with money in this currency count towards the usual', async () => {
    await txn('2026-06-03', 'Groceries', 500_000, { accountId: null, currency: 'INR' });
    await txn('2026-07-03', 'Groceries', 500_000, { accountId: null, currency: 'INR' });
    await txn('2026-08-03', 'Groceries', 30_000);
    expect(await row('2026-09', 'Groceries')).toMatchObject({ usual: 30_000 });
  });
});

describe('extras switches', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('are on for a new family and can be switched off', async () => {
    const call = client(app, (await signUp(app)).cookie);
    expect((await call('GET', '/api/family')).json().data.extras).toEqual({
      moneyStory: true,
      quickEntrySuggestions: true,
    });
    const res = await call('PUT', '/api/family', { extras: { moneyStory: false } });
    expect(res.json().data.extras).toEqual({ moneyStory: false, quickEntrySuggestions: true });
    // Unknown or empty switches are a mistake, not a silent no-op.
    expect(
      (await call('PUT', '/api/family', { extras: { quickEntryHints: false } })).statusCode,
    ).toBe(400);
    expect((await call('PUT', '/api/family', { extras: {} })).statusCode).toBe(400);
  });
});

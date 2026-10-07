import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('month quick entry', () => {
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

  const save = (entries: object[], accountId = eur.id) =>
    call('PUT', '/api/month-entry/2026-09', { accountId, entries });
  const grid = async () =>
    (await call('GET', `/api/month-entry/2026-09?accountId=${eur.id}`)).json().data;
  const amountOf = (g: { rows: { categoryId: string; amount: number | null }[] }, n: string) =>
    g.rows.find((r) => r.categoryId === cat(n))!.amount;

  it('creates one monthly-total transaction per category, typed by the category kind', async () => {
    const res = await save([
      { categoryId: cat('Salary'), amount: 375_000 },
      { categoryId: cat('Rent'), amount: 91_200 },
    ]);
    expect(res.statusCode).toBe(200);
    expect(amountOf(res.json().data, 'Rent')).toBe(91_200);
    const txns = await prisma.transaction.findMany({ orderBy: { amount: 'asc' } });
    expect(
      txns.map((t) => [
        t.type,
        Number(t.amount),
        t.isMonthlyTotal,
        t.date.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ['expense', 91_200, true, '2026-09-01'],
      ['income', 375_000, true, '2026-09-01'],
    ]);
  });

  it('is idempotent: saving again updates in place; null deletes; individual transactions untouched', async () => {
    await call('POST', '/api/transactions', {
      date: '2026-09-15',
      amount: 5_240,
      type: 'expense',
      accountId: eur.id,
      categoryId: cat('Groceries'),
    });
    await save([
      { categoryId: cat('Rent'), amount: 91_200 },
      { categoryId: cat('Groceries'), amount: 30_000 },
    ]);
    await save([
      { categoryId: cat('Rent'), amount: 95_000 },
      { categoryId: cat('Groceries'), amount: 30_000 },
    ]);
    expect(await prisma.transaction.count({ where: { isMonthlyTotal: true } })).toBe(2);
    await save([{ categoryId: cat('Groceries'), amount: null }]);

    const g = await grid();
    expect(amountOf(g, 'Rent')).toBe(95_000);
    expect(amountOf(g, 'Groceries')).toBe(null);
    expect(
      g.rows.find((r: { categoryId: string }) => r.categoryId === cat('Groceries'))
        .otherTransactions,
    ).toBe(1);
    expect(await prisma.transaction.count({ where: { isMonthlyTotal: false } })).toBe(1);
  });

  it('feeds the budget summary and is flagged in transaction lists', async () => {
    await save([
      { categoryId: cat('Salary'), amount: 100_000 },
      { categoryId: cat('Restaurants'), amount: 20_000 },
    ]);
    const s = (await call('GET', '/api/budget/2026-09')).json().data;
    expect(s).toMatchObject({ netIncome: 100_000, fun: 20_000 });
    const list = (await call('GET', '/api/transactions?from=2026-09-01&to=2026-09-30')).json().data;
    expect(list.items.every((t: { isMonthlyTotal: boolean }) => t.isMonthlyTotal)).toBe(true);
  });

  it('keeps totals separate per account', async () => {
    const cash = (
      await call('POST', '/api/accounts', { name: 'Cash', type: 'cash', currency: 'EUR' })
    ).json().data;
    await save([{ categoryId: cat('Rent'), amount: 100 }]);
    await save([{ categoryId: cat('Rent'), amount: 200 }], cash.id);
    expect(amountOf(await grid(), 'Rent')).toBe(100);
    expect(await prisma.transaction.count()).toBe(2);
  });

  it('rejects foreign accounts/categories with 404 and writes nothing', async () => {
    const other = client(app, (await signUp(app)).cookie);
    const otherAcc = (
      await other('POST', '/api/accounts', { name: 'X', type: 'cash', currency: 'EUR' })
    ).json().data;
    const otherCats: { id: string; name: string }[] = (await other('GET', '/api/categories')).json()
      .data;
    const foreignAcc = await save([{ categoryId: cat('Rent'), amount: 1 }], otherAcc.id);
    expect(foreignAcc.statusCode).toBe(404);
    expect(foreignAcc.json().error.message).toBe('Account not found');
    const res = await save([
      { categoryId: cat('Rent'), amount: 1 },
      { categoryId: otherCats[0]!.id, amount: 1 },
    ]);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Category not found');
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('refuses archived accounts', async () => {
    await call('PUT', `/api/accounts/${eur.id}`, { archived: true });
    const res = await save([{ categoryId: cat('Rent'), amount: 1 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ACCOUNT_ARCHIVED');
  });

  it('validates amounts and month', async () => {
    expect((await save([{ categoryId: cat('Rent'), amount: 0 }])).statusCode).toBe(400);
    expect((await save([{ categoryId: cat('Rent'), amount: 1.5 }])).statusCode).toBe(400);
    expect(
      (await call('PUT', '/api/month-entry/2026-9', { accountId: eur.id, entries: [] })).statusCode,
    ).toBe(400);
  });

  it('editing a monthly total elsewhere into another category turns it into a normal transaction (no hidden duplicates)', async () => {
    await save([
      { categoryId: cat('Rent'), amount: 1_002 },
      { categoryId: cat('Groceries'), amount: 30_000 },
    ]);
    const groceries = await prisma.transaction.findFirstOrThrow({
      where: { categoryId: cat('Groceries') },
    });
    const res = await call('PUT', `/api/transactions/${groceries.id}`, {
      date: '2026-09-01',
      amount: 30_000,
      type: 'expense',
      accountId: eur.id,
      categoryId: cat('Rent'),
    });
    expect(res.json().data.isMonthlyTotal).toBe(false);

    const g = await grid();
    expect(amountOf(g, 'Rent')).toBe(1_002);
    expect(amountOf(g, 'Groceries')).toBe(null);
    expect(
      await prisma.transaction.count({ where: { categoryId: cat('Rent'), isMonthlyTotal: true } }),
    ).toBe(1);
    const s = (await call('GET', '/api/budget/2026-09')).json().data;
    expect(s.essentials).toBe(31_002);
  });

  it('keeps the monthly-total flag when only the amount or notes change', async () => {
    await save([{ categoryId: cat('Rent'), amount: 1_000 }]);
    const rent = await prisma.transaction.findFirstOrThrow({ where: { categoryId: cat('Rent') } });
    await call('PUT', `/api/transactions/${rent.id}`, {
      date: '2026-09-01',
      amount: 2_000,
      type: 'expense',
      accountId: eur.id,
      categoryId: cat('Rent'),
      notes: 'raised',
    });
    expect(amountOf(await grid(), 'Rent')).toBe(2_000);
  });
});

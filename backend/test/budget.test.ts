import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

async function family(app: FastifyInstance, name = 'Surya') {
  const call = client(app, (await signUp(app, { name })).cookie);
  const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
  const eur = await acc({ name: 'Sparkasse', type: 'current', currency: 'EUR' });
  const inr = await acc({ name: 'ICICI', type: 'savings', currency: 'INR' });
  const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const txn = (
    accountId: string,
    type: string,
    amount: number,
    category: string,
    date = '2026-09-10',
  ) =>
    call('POST', '/api/transactions', { date, amount, type, accountId, categoryId: cat(category) });
  return { call, eur, inr, cat, txn };
}

describe('budget', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
  });
  afterEach(() => app.close());

  const summary = async (month = '2026-09') =>
    (await f.call('GET', `/api/budget/${month}`)).json().data;

  it('summarises the month in the spending currency, converting INR with the rate', async () => {
    await f.txn(f.eur.id, 'income', 575_000, 'Salary');
    await f.txn(f.eur.id, 'expense', 91_200, 'Rent');
    await f.txn(f.eur.id, 'expense', 17_200, 'Restaurants');
    await f.txn(f.eur.id, 'expense', 58_000, 'Stocks');
    await f.txn(f.inr.id, 'expense', 1_000_000, 'Groceries'); // ₹10,000
    await f.txn(f.eur.id, 'expense', 99_999, 'Rent', '2026-10-01'); // other month
    await f.call('PUT', '/api/exchange-rates', {
      month: '2026-09',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });

    const s = await summary();
    expect(s).toMatchObject({
      currency: 'EUR',
      netIncome: 575_000,
      essentials: 91_200 + 10_000,
      fun: 17_200,
      future: 58_000,
      unconverted: [],
    });
    expect(s.buckets.map((b: { bucket: string }) => b.bucket)).toEqual([
      'essentials',
      'fun',
      'future',
    ]);
  });

  it('reports INR as unconverted when no rate exists', async () => {
    await f.txn(f.inr.id, 'expense', 1_000_000, 'Groceries');
    const s = await summary();
    expect(s.essentials).toBe(0);
    expect(s.unconverted).toEqual([{ currency: 'INR', amount: 1_000_000 }]);
  });

  it('sets, updates and clears category limits', async () => {
    const put = (limits: object[]) => f.call('PUT', '/api/budget/2026-09/limits', { limits });
    await f.txn(f.eur.id, 'expense', 30_000, 'Groceries');
    let res = await put([{ categoryId: f.cat('Groceries'), amount: 25_000 }]);
    expect(res.statusCode).toBe(200);
    const row = (s: { categories: { categoryId: string }[] }) =>
      s.categories.find((c) => c.categoryId === f.cat('Groceries'));
    expect(row(res.json().data)).toMatchObject({ limit: 25_000, remaining: -5_000, over: true });

    res = await put([{ categoryId: f.cat('Groceries'), amount: 40_000 }]);
    expect(row(res.json().data)).toMatchObject({ limit: 40_000, over: false });
    res = await put([{ categoryId: f.cat('Groceries'), amount: null }]);
    expect(row(res.json().data)).toMatchObject({ limit: null });
    expect(await prisma.categoryLimit.count()).toBe(0);
  });

  it('rejects limits on income categories, and foreign categories with 404 writing nothing', async () => {
    const put = (limits: object[]) => f.call('PUT', '/api/budget/2026-09/limits', { limits });
    expect((await put([{ categoryId: f.cat('Salary'), amount: 100 }])).statusCode).toBe(400);
    const other = await family(app, 'Mallory');
    const res = await put([
      { categoryId: f.cat('Rent'), amount: 100 },
      { categoryId: other.cat('Rent'), amount: 100 },
    ]);
    expect(res.statusCode).toBe(404);
    expect(await prisma.categoryLimit.count()).toBe(0);
  });

  it("copies last month's limits, replacing this month's", async () => {
    await f.call('PUT', '/api/budget/2026-08/limits', {
      limits: [
        { categoryId: f.cat('Rent'), amount: 91_200 },
        { categoryId: f.cat('Groceries'), amount: 30_000 },
      ],
    });
    await f.call('PUT', '/api/budget/2026-09/limits', {
      limits: [{ categoryId: f.cat('Travel'), amount: 5 }],
    });
    const res = await f.call('POST', '/api/budget/2026-09/copy-previous', {});
    expect(res.statusCode).toBe(200);
    const limited = res
      .json()
      .data.categories.filter((c: { limit: number | null }) => c.limit !== null);
    expect(limited.map((c: { name: string }) => c.name).sort()).toEqual(['Groceries', 'Rent']);
  });

  it('copy-previous with nothing to copy is 409', async () => {
    const res = await f.call('POST', '/api/budget/2026-09/copy-previous', {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_PREVIOUS_LIMITS');
  });

  it('rejects a malformed month', async () => {
    expect((await f.call('GET', '/api/budget/2026-13')).statusCode).toBe(400);
  });

  it('isolates families', async () => {
    await f.txn(f.eur.id, 'income', 100, 'Salary');
    const other = await family(app, 'Mallory');
    const s = (await other.call('GET', '/api/budget/2026-09')).json().data;
    expect(s.netIncome).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

const thisMonth = new Date().toISOString().slice(0, 7);

/** EUR spending, INR wealth; EUR→INR = 100 for September and for the current month. */
async function family(app: FastifyInstance) {
  const call = client(app, (await signUp(app)).cookie);
  const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
  const eur = await acc({ name: 'Sparkasse', type: 'current', currency: 'EUR' });
  const inr = await acc({
    name: 'ICICI',
    type: 'savings',
    currency: 'INR',
    openingBalance: 1_000_000,
  });
  const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const txn = (accountId: string, type: string, amount: number, category: string, date: string) =>
    call('POST', '/api/transactions', { date, amount, type, accountId, categoryId: cat(category) });
  for (const month of new Set(['2026-09', thisMonth])) {
    await call('PUT', '/api/exchange-rates', { month, base: 'EUR', quote: 'INR', rate: '100' });
  }
  return { call, eur, inr, cat, txn };
}

describe('viewing money in another currency', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
  });
  afterEach(() => app.close());

  it('budget: totals and limits in the chosen currency; limits read-only there', async () => {
    await f.txn(f.eur.id, 'income', 100_000, 'Salary', '2026-09-01');
    await f.txn(f.eur.id, 'expense', 30_000, 'Groceries', '2026-09-02');
    await f.call('PUT', '/api/budget/2026-09/limits', {
      limits: [{ categoryId: f.cat('Groceries'), amount: 25_000 }],
    });

    const eur = (await f.call('GET', '/api/budget/2026-09')).json().data;
    expect(eur).toMatchObject({ currency: 'EUR', limitsEditable: true, netIncome: 100_000 });

    const inr = (await f.call('GET', '/api/budget/2026-09?currency=INR')).json().data;
    expect(inr).toMatchObject({ currency: 'INR', limitsEditable: false, netIncome: 10_000_000 });
    const groceries = inr.categories.find((c: { name: string }) => c.name === 'Groceries');
    expect(groceries).toMatchObject({ actual: 3_000_000, limit: 2_500_000, over: true });
  });

  it('rejects an unknown currency', async () => {
    expect((await f.call('GET', '/api/budget/2026-09?currency=XYZ')).statusCode).toBe(400);
    expect((await f.call('GET', '/api/net-worth?currency=XYZ')).statusCode).toBe(400);
  });

  it('dashboard: period figures and the accounts total in the chosen currency', async () => {
    await f.txn(f.eur.id, 'income', 100_000, 'Salary', '2026-09-01');
    const d = (await f.call('GET', '/api/dashboard?from=2026-09&to=2026-09&currency=INR')).json()
      .data;
    expect(d).toMatchObject({ currency: 'INR' });
    expect(d.totals.netIncome).toBe(10_000_000);
    expect(d.accountsTotal).toEqual({
      currency: 'INR',
      total: 10_000_000 + 1_000_000,
      unconverted: [],
    });
  });

  it('net worth: current figures and snapshots in the chosen currency', async () => {
    await f.call('POST', '/api/net-worth/snapshots', {}); // stored in INR: ₹10,000
    const nw = (await f.call('GET', '/api/net-worth?currency=EUR')).json().data;
    expect(nw.current).toMatchObject({ currency: 'EUR', netWorth: 10_000 });
    expect(nw.snapshots[0]).toMatchObject({ currency: 'EUR', netWorth: 10_000 });
    const plain = (await f.call('GET', '/api/net-worth')).json().data;
    expect(plain.snapshots[0]).toMatchObject({ currency: 'INR', netWorth: 1_000_000 });
  });

  it('keeps a snapshot in its own currency when it cannot be converted', async () => {
    await f.call('POST', '/api/net-worth/snapshots', {});
    const nw = (await f.call('GET', '/api/net-worth?currency=USD')).json().data;
    expect(nw.snapshots[0]).toMatchObject({ currency: 'INR', netWorth: 1_000_000 });
  });

  it('accounts: one total in the chosen currency, unconvertible ones listed', async () => {
    await f.txn(f.eur.id, 'income', 5_000, 'Salary', `${thisMonth}-01`);
    const total = (await f.call('GET', '/api/accounts/total?currency=EUR')).json().data;
    expect(total).toEqual({ currency: 'EUR', total: 5_000 + 10_000, unconverted: [] });
    const usd = (await f.call('GET', '/api/accounts/total?currency=USD')).json().data;
    expect(usd.unconverted).toEqual([
      { currency: 'EUR', amount: 5_000 },
      { currency: 'INR', amount: 1_000_000 },
    ]);
  });

  it('transactions: the filtered totals also in the chosen currency', async () => {
    await f.txn(f.eur.id, 'expense', 1_000, 'Groceries', '2026-09-03');
    await f.txn(f.inr.id, 'expense', 100_000, 'Groceries', '2026-09-04');
    const list = (await f.call('GET', '/api/transactions?currency=EUR')).json().data;
    expect(list.converted).toEqual({
      currency: 'EUR',
      income: 0,
      expense: 2_000,
      unconverted: [],
    });
    expect((await f.call('GET', '/api/transactions')).json().data.converted).toBeNull();
  });
});

describe('budget limits without a rate', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('are reported, not silently dropped', async () => {
    const f = await family(app);
    await f.call('PUT', '/api/budget/2026-09/limits', {
      limits: [{ categoryId: f.cat('Groceries'), amount: 25_000 }],
    });
    const usd = (await f.call('GET', '/api/budget/2026-09?currency=USD')).json().data;
    expect(usd.unconvertedLimits).toEqual([
      { categoryId: f.cat('Groceries'), amount: 25_000, currency: 'EUR' },
    ]);
    const eur = (await f.call('GET', '/api/budget/2026-09')).json().data;
    expect(eur.unconvertedLimits).toEqual([]);
  });
});

describe('budget limits keep their currency', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('a €250 limit stays €250 (₹25,000) after the spending currency changes to INR', async () => {
    const f = await family(app);
    await f.call('PUT', '/api/budget/2026-09/limits', {
      limits: [{ categoryId: f.cat('Groceries'), amount: 25_000 }],
    });
    await f.call('PUT', '/api/family', { spendingCurrency: 'INR' });
    const s = (await f.call('GET', '/api/budget/2026-09')).json().data;
    const groceries = s.categories.find((c: { name: string }) => c.name === 'Groceries');
    expect(s.currency).toBe('INR');
    expect(groceries.limit).toBe(2_500_000);
    expect(s.limitsEditable).toBe(true);

    // A limit set now is in INR.
    await f.call('PUT', '/api/budget/2026-09/limits', {
      limits: [{ categoryId: f.cat('Rent'), amount: 9_000_000 }],
    });
    const eur = (await f.call('GET', '/api/budget/2026-09?currency=EUR')).json().data;
    expect(eur.categories.find((c: { name: string }) => c.name === 'Rent').limit).toBe(90_000);
  });
});

describe('net worth comparisons', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  it('are empty when the nearest older snapshot cannot be converted (never an older one instead)', async () => {
    const f = await family(app);
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await f.call('PUT', '/api/family', { wealthCurrency: 'EUR' });
    await f.call('POST', '/api/net-worth/snapshots', { date: daysAgo(400), netWorth: 50_000 });
    await f.call('PUT', '/api/family', { wealthCurrency: 'INR' });
    // 60 days ago has no INR→EUR rate (the helper only adds September and this month).
    await f.call('POST', '/api/net-worth/snapshots', { date: daysAgo(60), netWorth: 9_000_000 });
    const nw = (await f.call('GET', '/api/net-worth?currency=EUR')).json().data;
    expect(nw.previousMonth).toBeNull();
    expect(nw.previousYear).toMatchObject({ currency: 'EUR', netWorth: 50_000 });
  });
});

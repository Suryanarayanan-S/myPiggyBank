import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

describe('dashboard API', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let cat: (n: string) => string;
  let eur: { id: string };
  let inr: { id: string };
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
    eur = await acc({
      name: 'Sparkasse',
      type: 'current',
      currency: 'EUR',
      openingBalance: 100_000,
    });
    inr = await acc({ name: 'ICICI', type: 'savings', currency: 'INR', openingBalance: 5_000_000 });
    await acc({ name: 'Old', type: 'cash', currency: 'EUR', openingBalance: 999, archived: true });
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    cat = (n) => cats.find((c) => c.name === n)!.id;
    const txn = (accountId: string, date: string, type: string, amount: number, category: string) =>
      call('POST', '/api/transactions', {
        date,
        type,
        amount,
        accountId,
        categoryId: cat(category),
      });
    await txn(eur.id, '2026-07-01', 'income', 300_000, 'Salary');
    await txn(eur.id, '2026-07-03', 'expense', 91_200, 'Rent');
    await txn(eur.id, '2026-08-01', 'income', 300_000, 'Salary');
    await txn(eur.id, '2026-08-09', 'expense', 17_200, 'Restaurants');
    await txn(eur.id, '2026-08-10', 'expense', 58_000, 'Stocks');
    await txn(inr.id, '2026-08-15', 'expense', 1_000_000, 'Groceries');
  });
  afterEach(() => app.close());

  const dash = async (qs: string) => call('GET', `/api/dashboard?${qs}`);

  it('matches the Budget page for a single month', async () => {
    await call('PUT', '/api/exchange-rates', {
      month: '2026-08',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    const d = (await dash('from=2026-08&to=2026-08')).json().data;
    const b = (await call('GET', '/api/budget/2026-08')).json().data;
    for (const k of [
      'netIncome',
      'essentials',
      'fun',
      'future',
      'spent',
      'unused',
      'savingsRateBp',
    ] as const) {
      expect(d.totals[k]).toBe(b[k]);
    }
  });

  it('returns months, totals, previous period, categories, members, account balances and first month', async () => {
    await call('PUT', '/api/exchange-rates', {
      month: '2026-08',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    const res = await dash('from=2026-08&to=2026-08');
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.months).toHaveLength(1);
    expect(d.previous).toMatchObject({ netIncome: 300_000, essentials: 91_200 });
    expect(d.categories[0]).toMatchObject({ name: 'Stocks', actual: 58_000 });
    expect(d.members).toEqual([{ memberId: null, name: 'Shared', actual: 17_200 + 10_000 }]);
    expect(d.firstMonth).toBe('2026-07');
    expect(d.targets).toEqual({ essentials: 50, fun: 30, future: 20 });
    expect(d.accounts).toEqual([
      { currency: 'EUR', balance: 100_000 + 300_000 - 91_200 + 300_000 - 17_200 - 58_000 },
      { currency: 'INR', balance: 5_000_000 - 1_000_000 },
    ]);
  });

  it('surfaces INR amounts without an exchange rate', async () => {
    const d = (await dash('from=2026-07&to=2026-08')).json().data;
    expect(d.unconverted).toEqual([{ currency: 'INR', amount: 1_000_000 }]);
    expect(d.totals.essentials).toBe(91_200);
  });

  it.each([
    'from=2026-08&to=2026-07',
    'from=2010-01&to=2026-08',
    'from=2026-13&to=2026-14',
    'from=2026-08',
  ])('rejects a bad range %s', async (qs) => {
    expect((await dash(qs)).statusCode).toBe(400);
  });

  it('isolates families', async () => {
    const other = client(app, (await signUp(app)).cookie);
    const d = (await other('GET', '/api/dashboard?from=2026-07&to=2026-08')).json().data;
    expect(d.totals.netIncome).toBe(0);
    expect(d.firstMonth).toBeNull();
    expect(d.accounts).toEqual([]);
  });

  it('leaves demat and broker accounts out of the bank balances, as Wealth does', async () => {
    await call('POST', '/api/accounts', {
      name: 'Trade Republic',
      type: 'investment',
      currency: 'EUR',
      openingBalance: 50_000,
    });
    const d = (await dash('from=2026-08&to=2026-08')).json().data;
    const before = d.accounts.find((a: { currency: string }) => a.currency === 'EUR').balance;
    // Sparkasse alone: 1,000 + 3,000 + 3,000 − 912 − 172 − 580
    expect(before).toBe(100_000 + 300_000 + 300_000 - 91_200 - 17_200 - 58_000);
  });

  it("counts the period's payments and income without a category", async () => {
    const add = (date: string) =>
      call('POST', '/api/transactions', {
        date,
        type: 'expense',
        amount: 1_000,
        accountId: eur.id,
        categoryId: null,
      });
    await add('2026-08-20');
    await add('2026-08-21');
    await add('2026-06-01'); // before the period
    const d = (await dash('from=2026-07&to=2026-08')).json().data;
    expect(d.uncategorised).toEqual({ count: 2, latestMonth: '2026-08' });
  });
});

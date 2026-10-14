import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

async function family(app: FastifyInstance) {
  const call = client(app, (await signUp(app)).cookie);
  const eur = (
    await call('POST', '/api/accounts', { name: 'Giro', type: 'current', currency: 'EUR' })
  ).json().data;
  const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const txn = (date: string, type: string, amount: number, category: string) =>
    call('POST', '/api/transactions', {
      date,
      amount,
      type,
      accountId: eur.id,
      categoryId: cat(category),
    });
  return { call, txn };
}

describe('year report', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
    await f.txn('2025-01-01', 'income', 400_000, 'Salary');
    await f.txn('2025-01-05', 'expense', 100_000, 'Rent');
    // Later in 2025 than anything recorded in 2026: not part of the like-for-like comparison.
    await f.txn('2025-11-01', 'income', 999_000, 'Salary');
    await f.txn('2026-01-01', 'income', 500_000, 'Salary');
    await f.txn('2026-01-05', 'expense', 110_000, 'Rent');
    await f.txn('2026-02-01', 'income', 500_000, 'Salary');
    await f.txn('2026-02-09', 'expense', 20_000, 'Restaurants');
  });
  afterEach(() => app.close());

  it('gives the months, totals, averages and last year side by side', async () => {
    const r = (await f.call('GET', '/api/reports/year/2026')).json().data;
    expect(r).toMatchObject({
      year: 2026,
      currency: 'EUR',
      recordedMonths: 2,
      totals: { netIncome: 1_000_000, essentials: 110_000, fun: 20_000 },
      averages: { netIncome: 500_000 },
      previous: {
        recordedMonths: 1,
        through: '2025-02',
        label: 'Jan–Feb 2025',
        totals: { netIncome: 400_000 },
        unconverted: [],
      },
      // 2 months against 1: compared per month (500,000 vs 400,000), not as totals.
      changeBasis: 'average',
      change: { netIncome: { amount: 100_000, bp: 2500 } },
    });
    expect(r.months).toHaveLength(12);
    expect(r.categories.map((c: { name: string }) => c.name)).toEqual(['Rent', 'Restaurants']);
    // per month: 110,000 over 2 months against 100,000 in 1 month
    expect(r.categories[0]).toMatchObject({ actual: 110_000, previous: 100_000, changeBp: -4500 });
  });

  it('converts into the chosen currency', async () => {
    for (const month of ['2025-01', '2026-01']) {
      await f.call('PUT', '/api/exchange-rates', { month, base: 'EUR', quote: 'INR', rate: '100' });
    }
    const r = (await f.call('GET', '/api/reports/year/2026?currency=INR')).json().data;
    expect(r).toMatchObject({ currency: 'INR', totals: { netIncome: 100_000_000 } });
  });

  it('shows net worth at the start and end of the year from snapshots', async () => {
    await f.call('PUT', '/api/family', { wealthCurrency: 'EUR' });
    await f.call('POST', '/api/net-worth/snapshots', { date: '2025-12-31', netWorth: 1_000_000 });
    await f.call('POST', '/api/net-worth/snapshots', { date: '2026-03-31', netWorth: 1_200_000 });
    await f.call('POST', '/api/net-worth/snapshots', { date: '2026-06-30', netWorth: 1_500_000 });
    const r = (await f.call('GET', '/api/reports/year/2026')).json().data;
    expect(r.netWorth).toEqual({
      start: { date: '2025-12-31', amount: 1_000_000 },
      end: { date: '2026-06-30', amount: 1_500_000 },
    });
  });

  it('downloads as CSV for spreadsheets', async () => {
    const res = await f.call('GET', '/api/reports/year/2026.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).split('\r\n');
    expect(lines[0]).toBe('Currency;EUR');
    expect(lines[1]).toBe(
      'Month;Net income;Keep Me Alive;Make Me Happy;Make Me Rich;Uncategorised;Unused;Savings rate',
    );
    expect(lines[2]).toBe('2026-01;5000,00;1100,00;0,00;0,00;0,00;3900,00;78,0 %');
    expect(lines).toContain('Category;Bucket;2026;Jan–Feb 2025;Change');
    expect(res.headers['content-disposition']).toContain('report-2026-EUR.csv');
  });

  it.each(['abcd', '1899', '2101'])('refuses year %s', async (year) => {
    expect((await f.call('GET', `/api/reports/year/${year}`)).statusCode).toBe(400);
  });

  it('only reports the caller’s family', async () => {
    const other = await family(app);
    const r = (await other.call('GET', '/api/reports/year/2026')).json().data;
    expect(r.totals.netIncome).toBe(0);
    expect(r.categories).toEqual([]);
  });

  it('a finished year is compared with the whole year before', async () => {
    const r = (await f.call('GET', '/api/reports/year/2025')).json().data;
    expect(r.recordedMonths).toBe(2);
    expect(r.totals.netIncome).toBe(1_399_000);
    expect(r.previous).toBeNull();
  });

  it('lists last year’s money without a rate instead of dropping it', async () => {
    const chf = (
      await f.call('POST', '/api/accounts', { name: 'UBS', type: 'current', currency: 'CHF' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await f.call('GET', '/api/categories')).json()
      .data;
    await f.call('POST', '/api/transactions', {
      date: '2025-02-10',
      amount: 50_000,
      type: 'expense',
      accountId: chf.id,
      categoryId: cats.find((c) => c.name === 'Rent')!.id,
    });
    const r = (await f.call('GET', '/api/reports/year/2026')).json().data;
    expect(r.previous.unconverted).toEqual([{ currency: 'CHF', amount: 50_000 }]);
  });

  it('a year whose money all lacks a rate is recorded, with the amounts listed', async () => {
    const r = (await f.call('GET', '/api/reports/year/2026?currency=INR')).json().data;
    expect(r.recordedMonths).toBe(2);
    expect(r.unconverted).toEqual([{ currency: 'EUR', amount: 1_130_000 }]);
  });

  it('an entry dated later this year does not stretch the comparison', async () => {
    const thisYear = Number(new Date().toISOString().slice(0, 4));
    const month = new Date().toISOString().slice(5, 7);
    await f.txn(`${thisYear}-01-01`, 'income', 1, 'Salary');
    await f.txn(`${thisYear}-12-31`, 'expense', 1_000, 'Rent');
    const r = (await f.call('GET', `/api/reports/year/${thisYear}`)).json().data;
    // never later than this month of last year (the December entry does not count yet)
    expect(r.previous.through <= `${thisYear - 1}-${month}`).toBe(true);
    expect(r.months.find((m: { month: string }) => m.month === `${thisYear}-12`).recorded).toBe(
      month === '12',
    );
  });

  it('never shows the same snapshot as start and end', async () => {
    await f.call('PUT', '/api/family', { wealthCurrency: 'EUR' });
    await f.call('POST', '/api/net-worth/snapshots', { date: '2026-01-01', netWorth: 1_000_000 });
    const r = (await f.call('GET', '/api/reports/year/2026')).json().data;
    expect(r.netWorth).toEqual({ start: null, end: { date: '2026-01-01', amount: 1_000_000 } });
  });
});

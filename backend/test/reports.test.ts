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
      previous: { recordedMonths: 1, through: '2025-02', totals: { netIncome: 400_000 } },
      change: { netIncome: { amount: 600_000, bp: 15_000 } },
    });
    expect(r.months).toHaveLength(12);
    expect(r.categories.map((c: { name: string }) => c.name)).toEqual(['Rent', 'Restaurants']);
    expect(r.categories[0]).toMatchObject({ actual: 110_000, previous: 100_000, changeBp: 1000 });
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
    expect(res.headers['content-disposition']).toContain('report-2026.csv');
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    const lines = res.body.slice(1).split('\r\n');
    expect(lines[0]).toBe('Month;Net income;Essentials;Fun;Future You;Unused;Savings rate');
    expect(lines[1]).toBe('2026-01;5000,00;1100,00;0,00;0,00;3900,00;78,0 %');
    expect(lines).toContain('Category;Bucket;2026;2025;Change');
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
});

import { describe, expect, it } from 'vitest';
import { findInsights, type InsightInput, type InsightTxn } from '../../src/domain/insights.js';

let seq = 0;
const TODAY = '2026-10-14'; // full months: 2026-04 … 2026-09, current: 2026-10
const cats = [
  { id: 'groc', name: 'Groceries', bucket: 'essentials' as const },
  { id: 'rest', name: 'Restaurants', bucket: 'fun' as const },
  { id: 'shop', name: 'Shopping', bucket: 'fun' as const },
  { id: 'subs', name: 'Subscriptions', bucket: 'fun' as const },
  { id: 'stock', name: 'Stocks', bucket: 'future' as const },
  { id: 'sal', name: 'Salary', bucket: null },
];
const bucketOf = (id: string) => cats.find((c) => c.id === id)!.bucket;
const exp = (
  date: string,
  categoryId: string,
  amount: number,
  extra: Partial<InsightTxn> = {},
): InsightTxn => ({
  date,
  type: 'expense',
  amount,
  categoryId,
  bucket: bucketOf(categoryId),
  merchant: null,
  isMonthlyTotal: true,
  ...extra,
  id: extra.id ?? `x${seq++}`,
});
const inc = (date: string, amount: number): InsightTxn => ({
  id: `x${seq++}`,
  date,
  type: 'income',
  amount,
  categoryId: 'sal',
  bucket: null,
  merchant: null,
  isMonthlyTotal: true,
});
const input = (txns: InsightTxn[], over: Partial<InsightInput> = {}): InsightInput => ({
  today: TODAY,
  categories: cats,
  txns,
  limits: [],
  goals: [],
  holdings: [],
  ...over,
});
const kinds = (r: ReturnType<typeof findInsights>) => r.map((i) => i.kind);

describe('findInsights', () => {
  it('says nothing without data', () => {
    expect(findInsights(input([]))).toEqual([]);
  });

  it('rising: a category up three full months in a row', () => {
    const r = findInsights(
      input([
        exp('2026-07-01', 'groc', 31_000),
        exp('2026-08-01', 'groc', 35_500),
        exp('2026-09-01', 'groc', 40_200),
      ]),
    );
    expect(r.find((i) => i.kind === 'rising')).toMatchObject({
      tone: 'warning',
      data: { category: 'Groceries', amounts: [31_000, 35_500, 40_200] },
      link: '/budget?month=2026-09',
    });
  });

  it('rising needs real steps (≥ 5 % and ≥ 10 units each)', () => {
    const r = findInsights(
      input([
        exp('2026-07-01', 'groc', 31_000),
        exp('2026-08-01', 'groc', 31_500),
        exp('2026-09-01', 'groc', 40_000),
      ]),
    );
    expect(kinds(r)).not.toContain('rising');
  });

  it('vsAverage: the last full month far from its usual, only the biggest one', () => {
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const r = findInsights(
      input([
        ...months.map((m) => exp(`${m}-10`, 'rest', 20_000)),
        exp('2026-09-10', 'rest', 31_000), // +55 %
        ...months.map((m) => exp(`${m}-10`, 'shop', 10_000)),
        exp('2026-09-10', 'shop', 16_000), // +60 % but only +60 units
      ]),
    );
    const v = r.filter((i) => i.kind === 'vsAverage');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      tone: 'warning',
      data: { category: 'Restaurants', month: '2026-09', amount: 31_000, usual: 20_000, bp: 5500 },
    });
  });

  it('overLimit: over this month, with how often in the last six', () => {
    const r = findInsights(
      input(
        [
          exp('2026-10-05', 'groc', 29_600),
          exp('2026-08-05', 'groc', 30_000),
          exp('2026-06-05', 'groc', 26_000),
        ],
        {
          limits: [
            { month: '2026-10', categoryId: 'groc', amount: 25_000 },
            { month: '2026-08', categoryId: 'groc', amount: 25_000 },
            { month: '2026-06', categoryId: 'groc', amount: 25_000 },
          ],
        },
      ),
    );
    expect(r.find((i) => i.kind === 'overLimit')).toMatchObject({
      tone: 'warning',
      data: { category: 'Groceries', over: 4_600, pastMonthsOver: 2 },
    });
  });

  it('subscription: the same merchant and amount in 3 of the last 4 full months', () => {
    const r = findInsights(
      input(
        ['2026-06-03', '2026-07-03', '2026-09-03'].map((d) =>
          exp(d, 'subs', 1_399, { merchant: 'NETFLIX.COM', isMonthlyTotal: false }),
        ),
      ),
    );
    expect(r.find((i) => i.kind === 'subscription')).toMatchObject({
      tone: 'info',
      data: { merchant: 'NETFLIX.COM', monthly: 1_399, yearly: 16_788 },
    });
  });

  it('subscription ignores monthly totals and changing amounts', () => {
    const r = findInsights(
      input([
        ...['2026-06-03', '2026-07-03', '2026-08-03'].map((d) =>
          exp(d, 'subs', 1_399, { merchant: 'Netflix' }),
        ),
        ...[1_000, 2_000, 3_000].map((a, i) =>
          exp(`2026-0${6 + i}-04`, 'shop', a, { merchant: 'Amazon', isMonthlyTotal: false }),
        ),
      ]),
    );
    expect(kinds(r)).not.toContain('subscription');
  });

  it('savingsTrend: last three full months against the three before', () => {
    const txns = ['04', '05', '06', '07', '08', '09'].flatMap((m, i) => [
      inc(`2026-${m}-01`, 100_000),
      exp(`2026-${m}-02`, 'groc', i < 3 ? 80_000 : 70_000), // rate 20 % then 30 %
    ]);
    expect(findInsights(input(txns)).find((i) => i.kind === 'savingsTrend')).toMatchObject({
      tone: 'good',
      data: { recentBp: 3000, earlierBp: 2000 },
    });
  });

  it('goalBehind and holding come from their own numbers', () => {
    const r = findInsights(
      input([], {
        goals: [
          {
            id: 'house',
            name: 'House',
            currency: 'EUR',
            status: 'active',
            progress: {
              onTrack: false,
              overdue: false,
              monthlyNeeded: 31_000,
              pace: 12_000,
              left: 500_000,
            },
          },
          {
            id: 'car',
            name: 'Car',
            currency: 'EUR',
            status: 'active',
            progress: { onTrack: true, overdue: false, monthlyNeeded: 1, pace: 2, left: 1 },
          },
        ],
        holdings: [
          {
            id: 'etf',
            name: 'ETF',
            currency: 'EUR',
            archived: false,
            value: 120_000,
            unrealised: 20_000,
            returnBp: 2000,
          },
          {
            id: 'gold',
            name: 'Gold',
            currency: 'EUR',
            archived: false,
            value: 9_000,
            unrealised: -1_000,
            returnBp: -1000,
          },
          {
            id: 'tiny',
            name: 'Tiny',
            currency: 'EUR',
            archived: false,
            value: 100,
            unrealised: 1,
            returnBp: 100,
          },
        ],
      }),
    );
    expect(r.filter((i) => i.kind === 'goalBehind').map((i) => i.data.name)).toEqual(['House']);
    expect(r.filter((i) => i.kind === 'holding').map((i) => [i.data.name, i.tone])).toEqual([
      ['Gold', 'warning'],
      ['ETF', 'good'],
    ]);
  });

  it('large: a recent payment ≥ 3× its category’s usual single payment', () => {
    const usual = ['04', '05', '06', '07', '08', '09'].map((m) =>
      exp(`2026-${m}-12`, 'shop', 4_000, { isMonthlyTotal: false, merchant: 'dm' }),
    );
    const r = findInsights(
      input([
        ...usual,
        exp('2026-10-03', 'shop', 24_000, { isMonthlyTotal: false, merchant: 'MediaMarkt' }),
      ]),
    );
    expect(r.find((i) => i.kind === 'large')).toMatchObject({
      tone: 'info',
      data: {
        merchant: 'MediaMarkt',
        amount: 24_000,
        date: '2026-10-03',
        category: 'Shopping',
        times: 6,
      },
    });
  });

  it('orders warnings first, then information, then good news', () => {
    const r = findInsights(
      input([], {
        holdings: [
          {
            id: 'etf',
            name: 'ETF',
            currency: 'EUR',
            archived: false,
            value: 1,
            unrealised: 1,
            returnBp: 2000,
          },
          {
            id: 'gold',
            name: 'Gold',
            currency: 'EUR',
            archived: false,
            value: 1,
            unrealised: -1,
            returnBp: -1000,
          },
        ],
      }),
    );
    expect(r.map((i) => i.tone)).toEqual(['warning', 'good']);
  });

  it('shows at most five regular payments, the largest first', () => {
    const merchants = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const r = findInsights(
      input(
        merchants.flatMap((m, k) =>
          ['2026-07-03', '2026-08-03', '2026-09-03'].map((d) =>
            exp(d, 'subs', 1_000 * (k + 1), { merchant: m, isMonthlyTotal: false }),
          ),
        ),
      ),
    );
    expect(r.filter((i) => i.kind === 'subscription').map((i) => i.data.merchant)).toEqual([
      'G',
      'F',
      'E',
      'D',
      'C',
    ]);
  });

  it('savings trend weighs months by income (a month with almost no income does not wreck it)', () => {
    const txns = ['04', '05', '06', '07', '08'].flatMap((m) => [
      inc(`2026-${m}-01`, 300_000),
      exp(`2026-${m}-02`, 'groc', 200_000),
    ]);
    txns.push(inc('2026-09-01', 500), exp('2026-09-02', 'groc', 200_000));
    const t = findInsights(input(txns)).find((i) => i.kind === 'savingsTrend');
    // last 3 months: (2 × 100,000 + 500 − 200,000) / 600,500 ≈ 0.1 %; before: 33.3 %
    expect(t?.data).toEqual({ recentBp: 8, earlierBp: 3333 });
  });

  it('ranks by kind first: this month’s over-limit before a goal, before the trend', () => {
    const r = findInsights(
      input(
        [
          exp('2026-10-05', 'groc', 30_000),
          ...['04', '05', '06'].flatMap((m) => [
            inc(`2026-${m}-01`, 100_000),
            exp(`2026-${m}-02`, 'rest', 50_000),
          ]),
          ...['07', '08', '09'].flatMap((m) => [
            inc(`2026-${m}-01`, 100_000),
            exp(`2026-${m}-02`, 'rest', 90_000),
          ]),
        ],
        {
          limits: [{ month: '2026-10', categoryId: 'groc', amount: 25_000 }],
          goals: [
            {
              id: 'g1',
              name: 'House',
              currency: 'INR',
              status: 'active',
              progress: {
                onTrack: false,
                overdue: false,
                monthlyNeeded: 1,
                pace: 0,
                left: 300_000_000,
              },
            },
          ],
        },
      ),
    );
    expect(
      r
        .filter((i) => i.tone === 'warning')
        .map((i) => i.kind)
        .slice(0, 3),
    ).toEqual(['overLimit', 'goalBehind', 'savingsTrend']);
  });

  it('a merchant paid several times a month is not a regular payment', () => {
    const rewe = ['07', '08', '09'].flatMap((m) =>
      [3, 10, 17, 24].map((d) =>
        exp(`2026-${m}-${d}`, 'groc', 9_000, { merchant: 'REWE', isMonthlyTotal: false }),
      ),
    );
    expect(kinds(findInsights(input(rewe)))).not.toContain('subscription');
  });

  it('ids are unique even for same names (goals, holdings) and same payments', () => {
    const goal = (id: string) => ({
      id,
      name: 'House',
      currency: 'EUR',
      status: 'active',
      progress: { onTrack: false, overdue: false, monthlyNeeded: 1, pace: 0, left: 1 },
    });
    const usual = ['04', '05', '06', '07', '08'].map((m, k) =>
      exp(`2026-${m}-12`, 'shop', 4_000, { isMonthlyTotal: false, id: `u${k}` }),
    );
    const r = findInsights(
      input(
        [
          ...usual,
          exp('2026-10-03', 'shop', 20_000, { isMonthlyTotal: false, id: 't1' }),
          exp('2026-10-03', 'shop', 20_000, { isMonthlyTotal: false, id: 't2' }),
        ],
        {
          goals: [goal('g1'), goal('g2')],
          holdings: [
            {
              id: 'h1',
              name: 'ETF',
              currency: 'EUR',
              archived: false,
              value: 1,
              unrealised: 1,
              returnBp: 900,
            },
            {
              id: 'h2',
              name: 'ETF',
              currency: 'EUR',
              archived: false,
              value: 1,
              unrealised: -1,
              returnBp: -900,
            },
          ],
        },
      ),
    );
    const ids = r.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.filter((i) => i.kind === 'large')).toHaveLength(2); // also without a merchant
  });

  it('usual is the average of all five months; a category that stopped says so', () => {
    const r = findInsights(
      input(['04', '06', '08'].map((m) => exp(`2026-${m}-10`, 'rest', 60_000))),
    );
    expect(r.find((i) => i.kind === 'vsAverage')?.data).toMatchObject({ amount: 0, usual: 36_000 });
  });

  it('a payment exactly 30 days ago counts as an earlier one', () => {
    const earlier = ['04', '05', '06', '07', '08'].map((m, k) =>
      exp(`2026-${m}-12`, 'shop', 4_000, { isMonthlyTotal: false, id: `e${k}` }),
    );
    const r = findInsights(
      input([
        ...earlier.slice(1),
        exp('2026-09-14', 'shop', 4_000, { isMonthlyTotal: false, id: 'edge' }),
        exp('2026-10-03', 'shop', 20_000, { isMonthlyTotal: false, id: 'big' }),
      ]),
    );
    expect(kinds(r)).toContain('large'); // the 14 Sep payment makes the 5 earlier rows
  });
});

import { describe, expect, it } from 'vitest';
import { buildDashboard, monthsBetween, type DashboardTxn } from '../../src/domain/dashboard.js';
import type { Rate } from '../../src/domain/currency.js';

type B = 'essentials' | 'fun' | 'future' | null;
const categories = [
  { id: 'salary', name: 'Salary', kind: 'income', bucket: null as B },
  { id: 'rent', name: 'Rent', kind: 'expense', bucket: 'essentials' as B },
  { id: 'food', name: 'Restaurants', kind: 'expense', bucket: 'fun' as B },
  { id: 'stocks', name: 'Stocks', kind: 'expense', bucket: 'future' as B },
];
const members = [
  { id: 'm1', name: 'Surya' },
  { id: 'm2', name: 'Priya' },
];
const t = (
  month: string,
  type: 'income' | 'expense' | 'transfer',
  euros: number,
  categoryId: string | null,
  extra: Partial<DashboardTxn> = {},
): DashboardTxn => {
  const c = categories.find((x) => x.id === categoryId);
  return {
    month,
    type,
    amount: Math.round(euros * 100),
    currency: 'EUR',
    categoryId,
    categoryName: c?.name ?? null,
    bucket: c?.bucket ?? null,
    isMonthlyTotal: false,
    memberId: null,
    ...extra,
  };
};
const base = {
  currency: 'EUR',
  rates: [] as Rate[],
  targets: { essentials: 50, fun: 30, future: 20 },
  categories,
  members,
};

describe('monthsBetween', () => {
  it('lists every month inclusive, across years', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
  it('rejects inverted and over-long ranges', () => {
    expect(() => monthsBetween('2026-02', '2026-01')).toThrow();
    expect(() => monthsBetween('2010-01', '2026-01')).toThrow();
  });
});

describe('buildDashboard', () => {
  const txns = [
    t('2026-07', 'income', 3000, 'salary'),
    t('2026-07', 'expense', 900, 'rent', { memberId: 'm1' }),
    t('2026-08', 'income', 3000, 'salary'),
    t('2026-08', 'expense', 900, 'rent'),
    t('2026-08', 'expense', 600, 'food', { memberId: 'm2' }),
    t('2026-08', 'expense', 300, 'stocks', { memberId: 'm1' }),
    t('2026-08', 'transfer', 5000, null),
    // previous period (Apr–Jun) has one month of data
    t('2026-05', 'income', 2000, 'salary'),
    t('2026-05', 'expense', 1500, 'food'),
  ];
  const d = buildDashboard({ ...base, from: '2026-07', to: '2026-09', txns });

  it('lists every month in the range, including months without transactions', () => {
    expect(d.months.map((m) => [m.month, m.netIncome, m.spent])).toEqual([
      ['2026-07', 300_000, 90_000],
      ['2026-08', 300_000, 150_000],
      ['2026-09', 0, 0],
    ]);
    expect(d.months[2]!.savingsRateBp).toBeNull();
  });

  it('sums the months into period totals with savings rate and bucket shares', () => {
    expect(d.totals).toMatchObject({
      netIncome: 600_000,
      essentials: 180_000,
      fun: 60_000,
      future: 30_000,
      spent: 240_000,
      unused: 330_000,
      savingsRateBp: 6000, // (300 + 3300) / 6000
      sharesBp: { essentials: 3000, fun: 1000, future: 500 },
    });
  });

  it('compares with the preceding period of the same length', () => {
    expect(d.previous).toMatchObject({
      netIncome: 200_000,
      fun: 150_000,
      spent: 150_000,
      unused: 50_000,
    });
  });

  it('has no previous period when nothing was recorded before', () => {
    expect(
      buildDashboard({
        ...base,
        from: '2026-07',
        to: '2026-08',
        txns: txns.filter((x) => x.month >= '2026-07'),
      }).previous,
    ).toBeNull();
  });

  it('ranks expense categories and spending by member (Shared for none); Future You is not spending', () => {
    expect(d.categories).toEqual([
      { categoryId: 'rent', name: 'Rent', bucket: 'essentials', actual: 180_000 },
      { categoryId: 'food', name: 'Restaurants', bucket: 'fun', actual: 60_000 },
      { categoryId: 'stocks', name: 'Stocks', bucket: 'future', actual: 30_000 },
    ]);
    expect(d.members).toEqual([
      { memberId: null, name: 'Shared', actual: 90_000 },
      { memberId: 'm1', name: 'Surya', actual: 90_000 },
      { memberId: 'm2', name: 'Priya', actual: 60_000 },
    ]);
  });

  it("converts each month with that month's rate and reports amounts without a rate", () => {
    const rates: Rate[] = [
      { month: '2026-08', base: 'EUR', quote: 'INR', rateMicros: 100_000_000 },
    ];
    const inr = [
      t('2026-07', 'expense', 10_000, 'rent', { currency: 'INR' }), // no rate yet in July
      t('2026-08', 'expense', 10_000, 'rent', { currency: 'INR' }), // ₹10,000 → €100
    ];
    const x = buildDashboard({ ...base, rates, from: '2026-07', to: '2026-08', txns: inr });
    expect(x.totals.essentials).toBe(10_000);
    expect(x.unconverted).toEqual([{ currency: 'INR', amount: 1_000_000 }]);
  });

  it('handles a period without income', () => {
    const x = buildDashboard({
      ...base,
      from: '2026-09',
      to: '2026-09',
      txns: [t('2026-09', 'expense', 10, 'rent')],
    });
    expect(x.totals).toMatchObject({
      netIncome: 0,
      unused: -1_000,
      savingsRateBp: null,
      sharesBp: { essentials: null },
    });
  });
});

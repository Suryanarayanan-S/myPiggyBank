import { describe, expect, it } from 'vitest';
import { summarizeMonth, type SummaryTxn } from '../../src/domain/budget.js';
import type { Rate } from '../../src/domain/currency.js';

type Bucket = 'essentials' | 'fun' | 'future';
const cats: { id: string; name: string; kind: string; bucket: Bucket | null }[] = [
  { id: 'salary', name: 'Salary', kind: 'income', bucket: null },
  { id: 'refund', name: 'Tax refund', kind: 'income', bucket: null },
  { id: 'rent', name: 'Rent', kind: 'expense', bucket: 'essentials' },
  { id: 'other-ess', name: 'Other essentials', kind: 'expense', bucket: 'essentials' },
  { id: 'fun', name: 'Restaurants', kind: 'expense', bucket: 'fun' },
  { id: 'stocks', name: 'Stocks', kind: 'expense', bucket: 'future' },
  { id: 'unused-cat', name: 'Travel', kind: 'expense', bucket: 'fun' },
];
const cat = (id: string) => cats.find((c) => c.id === id)!;
const t = (
  type: SummaryTxn['type'],
  euros: number,
  categoryId: string | null,
  currency = 'EUR',
): SummaryTxn => {
  const c = categoryId ? cat(categoryId) : null;
  return {
    type,
    amount: Math.round(euros * 100),
    currency,
    categoryId,
    categoryName: c?.name ?? null,
    bucket: c?.bucket ?? null,
    isMonthlyTotal: false,
  };
};
const base = {
  month: '2026-09',
  currency: 'EUR',
  rates: [] as Rate[],
  targets: { essentials: 50, fun: 30, future: 20 },
  limits: [] as { categoryId: string; amount: number }[],
  categories: cats,
};

// Shape of the user's real September 2026 sheet.
const september = [
  t('income', 3750, 'salary'),
  t('income', 2000, 'refund'),
  t('expense', 912, 'rent'),
  t('expense', 296, 'other-ess'), // transport, phone, electricity, wifi, tax, insurance, bank
  t('expense', 172, 'fun'),
  t('expense', 580, 'stocks'),
];

describe('summarizeMonth', () => {
  it("reproduces the spreadsheet's month: net income, buckets, unused and savings rate", () => {
    const s = summarizeMonth({ ...base, txns: september });
    expect(s).toMatchObject({
      netIncome: 575_000,
      essentials: 120_800,
      fun: 17_200,
      future: 58_000,
      uncategorised: 0,
      spent: 138_000,
      unused: 379_000,
      savingsRateBp: 7600,
      unconverted: [],
    });
    expect(s.buckets).toEqual([
      {
        bucket: 'essentials',
        targetPct: 50,
        target: 287_500,
        actual: 120_800,
        actualBp: 2101,
        status: 'ok',
      },
      {
        bucket: 'fun',
        targetPct: 30,
        target: 172_500,
        actual: 17_200,
        actualBp: 299,
        status: 'ok',
      },
      {
        bucket: 'future',
        targetPct: 20,
        target: 115_000,
        actual: 58_000,
        actualBp: 1009,
        status: 'under',
      },
    ]);
  });

  it('marks essentials/fun over target and future ok when met', () => {
    const s = summarizeMonth({
      ...base,
      txns: [t('income', 1000, 'salary'), t('expense', 400, 'fun'), t('expense', 250, 'stocks')],
    });
    expect(s.buckets.map((b) => b.status)).toEqual(['ok', 'over', 'ok']);
  });

  it("converts other currencies with the month's rate, falling back to an earlier month", () => {
    const rates: Rate[] = [
      { month: '2026-08', base: 'EUR', quote: 'INR', rateMicros: 100_000_000 },
    ];
    const s = summarizeMonth({
      ...base,
      rates,
      txns: [t('income', 1000, 'salary'), t('expense', 5000, 'rent', 'INR')], // ₹5000 → €50
    });
    expect(s.essentials).toBe(5_000);
    expect(s.unconverted).toEqual([]);
  });

  it('never adds amounts 1:1 without a rate — reports them as unconverted instead', () => {
    const s = summarizeMonth({
      ...base,
      txns: [
        t('income', 1000, 'salary'),
        t('expense', 5000, 'rent', 'INR'),
        t('expense', 100, 'fun', 'INR'),
      ],
    });
    expect(s.essentials).toBe(0);
    expect(s.fun).toBe(0);
    expect(s.unconverted).toEqual([{ currency: 'INR', amount: 510_000 }]);
  });

  it('ignores transfers', () => {
    const s = summarizeMonth({
      ...base,
      txns: [t('income', 100, 'salary'), t('transfer', 50, null)],
    });
    expect(s.spent).toBe(0);
    expect(s.unused).toBe(10_000);
  });

  it('counts uncategorised expenses as spent and lists them', () => {
    const s = summarizeMonth({
      ...base,
      txns: [t('income', 100, 'salary'), t('expense', 30, null)],
    });
    expect(s).toMatchObject({ uncategorised: 3_000, spent: 3_000, unused: 7_000 });
    expect(s.categories.find((c) => c.categoryId === null)).toMatchObject({
      name: 'Uncategorised',
      actual: 3_000,
    });
  });

  it('handles a month with expenses but no income', () => {
    const s = summarizeMonth({ ...base, txns: [t('expense', 50, 'rent')] });
    expect(s).toMatchObject({ netIncome: 0, unused: -5_000, savingsRateBp: null });
    expect(s.buckets[0]).toMatchObject({ target: 0, actualBp: null });
  });

  it('handles a month with income but no expenses', () => {
    const s = summarizeMonth({ ...base, txns: [t('income', 100, 'salary')] });
    expect(s).toMatchObject({ spent: 0, unused: 10_000, savingsRateBp: 10_000 });
  });

  it('applies category limits: remaining, used % and over flag; lists every category', () => {
    const s = summarizeMonth({
      ...base,
      txns: september,
      limits: [
        { categoryId: 'rent', amount: 90_000 },
        { categoryId: 'fun', amount: 20_000 },
      ],
    });
    const row = (id: string) => s.categories.find((c) => c.categoryId === id)!;
    expect(row('rent')).toMatchObject({
      actual: 91_200,
      limit: 90_000,
      remaining: -1_200,
      usedBp: 10_133,
      over: true,
    });
    expect(row('fun')).toMatchObject({ remaining: 2_800, usedBp: 8600, over: false });
    expect(row('stocks')).toMatchObject({
      limit: null,
      remaining: null,
      usedBp: null,
      over: false,
    });
    expect(row('unused-cat')).toMatchObject({ actual: 0 });
    expect(s.categories[0]!.kind).toBe('income');
    expect(s.categories).toHaveLength(cats.length);
  });
});

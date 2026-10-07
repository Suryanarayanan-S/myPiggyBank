import { describe, expect, it } from 'vitest';
import { insightsFor, type InsightTotals } from './insights';

const totals = (p: Partial<InsightTotals> = {}): InsightTotals => ({
  netIncome: 575_000,
  essentials: 120_800,
  fun: 17_200,
  future: 58_000,
  spent: 138_000,
  unused: 379_000,
  savingsRateBp: 7600,
  sharesBp: { essentials: 2101, fun: 299, future: 1009 },
  ...p,
});
const targets = { essentials: 50, fun: 30, future: 20 };
const cats = [
  { name: 'Rent', actual: 91_200, bucket: 'essentials' as const },
  { name: 'Groceries', actual: 29_600, bucket: 'essentials' as const },
];
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe('insightsFor', () => {
  it('compares spending and savings rate with the previous period', () => {
    const prev = totals({ spent: 123_200, savingsRateBp: 7000 });
    const out = insightsFor(totals(), prev, targets, 'EUR', cats);
    expect(out).toContainEqual({
      tone: 'warning',
      text: 'Spending was 12.0 % higher than in the previous period (1.380,00\u00a0€ vs 1.232,00\u00a0€).',
    });
    expect(out).toContainEqual({
      tone: 'good',
      text: 'Savings rate 76.0 %, up from 70.0 % in the previous period.',
    });
  });

  it('reports lower spending as good', () => {
    const out = insightsFor(totals({ spent: 100_000 }), totals(), targets, 'EUR', cats);
    expect(out[0]).toMatchObject({ tone: 'good' });
    expect(out[0]!.text).toMatch(/^Spending was 27\.5 % lower/);
  });

  it('flags buckets against their targets', () => {
    const out = insightsFor(
      totals({ sharesBp: { essentials: 5500, fun: 3100, future: 1009 } }),
      null,
      targets,
      'EUR',
      cats,
    );
    expect(texts(out)).toEqual(
      expect.arrayContaining([
        'Essentials took 55.0 % of income, above its 50 % target.',
        'Fun took 31.0 % of income, above its 30 % target.',
        'Future You got 10.1 % of income, below its 20 % target.',
      ]),
    );
  });

  it('says so when every bucket is on target', () => {
    const out = insightsFor(
      totals({ sharesBp: { essentials: 4000, fun: 2000, future: 2500 } }),
      null,
      targets,
      'EUR',
      cats,
    );
    expect(out).toContainEqual({
      tone: 'good',
      text: 'All three buckets are within their 50 / 30 / 20 targets.',
    });
  });

  it('never calls Future You an expense, and never exceeds 100 % of spending', () => {
    const withSavings = [{ name: 'ETF', actual: 300_000, bucket: 'future' as const }, ...cats];
    const out = texts(insightsFor(totals({ spent: 200_000 }), null, targets, 'EUR', withSavings));
    expect(out.find((x) => x.includes('largest expense'))).toMatch(/^Rent was the largest expense/);
    const noSpending = insightsFor(totals({ spent: 0 }), null, targets, 'EUR', withSavings);
    expect(texts(noSpending).some((x) => x.includes('largest expense'))).toBe(false);
  });

  it('uses the same threshold for savings-rate rises and falls', () => {
    const tiny = insightsFor(
      totals({ savingsRateBp: 3002 }),
      totals({ savingsRateBp: 3000 }),
      targets,
      'EUR',
      cats,
    );
    expect(texts(tiny)).toContain(
      'Savings rate 30.0 %, about the same as the previous period (30.0 %).',
    );
    const fall = insightsFor(
      totals({ savingsRateBp: 2810 }),
      totals({ savingsRateBp: 3000 }),
      targets,
      'EUR',
      cats,
    );
    expect(fall).toContainEqual({
      tone: 'warning',
      text: 'Savings rate 28.1 %, down from 30.0 % in the previous period.',
    });
  });

  it('makes no comparisons at all without income, even with a previous period', () => {
    const out = insightsFor(
      totals({
        netIncome: 0,
        savingsRateBp: null,
        sharesBp: { essentials: null, fun: null, future: null },
      }),
      totals(),
      targets,
      'EUR',
      cats,
    );
    expect(out).toEqual([{ tone: 'info', text: 'No income recorded in this period yet.' }]);
  });

  it('names the largest expense category', () => {
    expect(texts(insightsFor(totals(), null, targets, 'EUR', cats))).toContain(
      'Rent was the largest expense: 912,00\u00a0€ (66.1 % of spending).',
    );
  });

  it('makes no percentage claims without income', () => {
    const out = insightsFor(
      totals({
        netIncome: 0,
        savingsRateBp: null,
        sharesBp: { essentials: null, fun: null, future: null },
      }),
      null,
      targets,
      'EUR',
      [],
    );
    expect(out).toEqual([{ tone: 'info', text: 'No income recorded in this period yet.' }]);
  });
});

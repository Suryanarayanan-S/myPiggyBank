import { describe, expect, it } from 'vitest';
import { insightText as write, type Insight } from './insightText';

/** Money is formatted with non-breaking spaces; compare them as plain spaces. */
const insightText = (...args: Parameters<typeof write>) =>
  write(...args).replace(/[\u00a0\u202f]/g, ' ');

const i = (
  kind: Insight['kind'],
  data: Insight['data'],
  tone: Insight['tone'] = 'info',
): Insight => ({
  id: kind,
  kind,
  tone,
  data,
  link: '/',
  size: 1,
});

describe('insightText', () => {
  it('writes each kind with its numbers, in the report currency', () => {
    expect(
      insightText(i('rising', { category: 'Groceries', amounts: [31_000, 35_500, 40_200] }), 'EUR'),
    ).toBe('Groceries rose three months in a row: 310,00 € → 355,00 € → 402,00 €.');
    expect(
      insightText(
        i('vsAverage', {
          category: 'Restaurants',
          month: '2026-09',
          amount: 31_000,
          usual: 20_900,
          bp: 4833,
        }),
        'EUR',
      ),
    ).toBe('In September, Restaurants was 48 % above its usual (310,00 € vs 209,00 €).');
    expect(
      insightText(i('overLimit', { category: 'Groceries', over: 4_600, pastMonthsOver: 3 }), 'EUR'),
    ).toBe('Groceries is 46,00 € over its limit this month — also over in 3 of the last 6 months.');
    expect(
      insightText(i('overLimit', { category: 'Fun', over: 100, pastMonthsOver: 0 }), 'EUR'),
    ).toBe('Fun is 1,00 € over its limit this month.');
    expect(
      insightText(
        i('subscription', { merchant: 'Netflix', monthly: 1_399, yearly: 16_788 }),
        'EUR',
      ),
    ).toBe('Netflix looks like a regular payment: about 13,99 € a month, 167,88 € a year.');
    expect(insightText(i('savingsTrend', { recentBp: 3100, earlierBp: 2400 }), 'EUR')).toBe(
      'Savings rate went up: 31 % over the last 3 months, 24 % the 3 before.',
    );
    expect(
      insightText(
        i('large', {
          merchant: 'MediaMarkt',
          amount: 84_000,
          date: '2026-10-03',
          category: 'Shopping',
          times: 6,
        }),
        'EUR',
      ),
    ).toBe('840,00 € at MediaMarkt on 3 Oct is about 6× a usual Shopping payment.');
  });

  it('goals and holdings speak in their own currency', () => {
    expect(
      insightText(
        i('goalBehind', {
          name: 'House',
          currency: 'INR',
          monthlyNeeded: 3_100_000,
          pace: 1_200_000,
          overdue: false,
          left: 1,
        }),
        'EUR',
      ),
    ).toBe('House is behind: ₹31,000.00 a month needed, ₹12,000.00 a month saved lately.');
    expect(
      insightText(
        i('goalBehind', { name: 'Car', currency: 'EUR', overdue: true, left: 50_000 }),
        'EUR',
      ),
    ).toBe('Car is past its date with 500,00 € still to save.');
    expect(
      insightText(
        i('holding', { name: 'ETF', currency: 'EUR', returnBp: 1640, unrealised: 21_190 }),
        'EUR',
      ),
    ).toBe('ETF is up 16 % (+211,90 €).');
    expect(
      insightText(
        i('holding', { name: 'Gold', currency: 'EUR', returnBp: -1000, unrealised: -1_000 }),
        'EUR',
      ),
    ).toBe('Gold is down 10 % (−10,00 €).');
  });

  it('never gives advice', () => {
    const all = [
      insightText(i('rising', { category: 'X', amounts: [1, 2, 3] }), 'EUR'),
      insightText(i('subscription', { merchant: 'Y', monthly: 1, yearly: 12 }), 'EUR'),
    ].join(' ');
    expect(all).not.toMatch(/should|must|consider|try to|recommend/i);
  });

  it('keeps signs and reads well at the edges', () => {
    expect(insightText(i('savingsTrend', { recentBp: -1000, earlierBp: 1000 }), 'EUR')).toBe(
      'Savings rate went down: −10 % over the last 3 months, 10 % the 3 before.',
    );
    expect(
      insightText(
        i('vsAverage', {
          category: 'Car repair',
          month: '2026-09',
          amount: 0,
          usual: 36_000,
          bp: -10_000,
        }),
        'EUR',
      ),
    ).toBe('Nothing on Car repair in September (usually 360,00 € a month).');
    expect(
      insightText(
        i('goalBehind', {
          name: 'House',
          currency: 'EUR',
          monthlyNeeded: 50_000,
          pace: -5_000,
          overdue: false,
          left: 1,
        }),
        'EUR',
      ),
    ).toBe('House is behind: 500,00 € a month needed, nothing saved lately.');
    expect(
      insightText(
        i('large', {
          merchant: null,
          amount: 90_000,
          date: '2026-10-03',
          category: 'Shopping',
          times: 6,
        }),
        'EUR',
      ),
    ).toBe('900,00 € on 3 Oct is about 6× a usual Shopping payment.');
  });
});

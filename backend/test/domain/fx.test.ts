import { describe, expect, it } from 'vitest';
import { changeOver, compareTransfer, fxSeries, rate, rateOn } from '../../src/domain/fx.js';

// dollars and rupees per euro (ECB), Friday to Tuesday; the weekend has none
const series = fxSeries(
  [
    { date: '2026-10-23', value: 1.1 },
    { date: '2026-10-26', value: 1.12 },
    { date: '2026-10-27', value: 1.125 },
  ],
  [
    { date: '2026-10-23', value: 99 },
    { date: '2026-10-26', value: 100.8 },
    { date: '2026-10-27', value: 101.25 },
    { date: '2026-10-28', value: 101.5 }, // no dollar rate that day: not a full point
  ],
);

describe('fx', () => {
  it('joins the two ECB series on the days both have', () => {
    expect(series.map((p) => p.date)).toEqual(['2026-10-23', '2026-10-26', '2026-10-27']);
  });

  it('gives any pair of euro, dollar and rupee from the rates per euro', () => {
    const p = series[2]!;
    expect(rate(p, 'EUR', 'INR')).toBeCloseTo(101.25);
    expect(rate(p, 'USD', 'INR')).toBeCloseTo(90); // 101.25 ÷ 1.125
    expect(rate(p, 'EUR', 'USD')).toBeCloseTo(1.125);
    expect(rate(p, 'INR', 'EUR')).toBeCloseTo(1 / 101.25);
    expect(rate(p, 'EUR', 'EUR')).toBe(1);
  });

  it('the rate on a day is the last one published on or before it', () => {
    expect(rateOn(series, '2026-10-25')!.date).toBe('2026-10-23'); // a Sunday
    expect(rateOn(series, '2026-10-22')).toBeNull(); // before the first
  });

  it('change over a number of days, from the rate on or before the start', () => {
    const c = changeOver(series, 'EUR', 'INR', 4, '2026-10-27')!;
    // 23 Oct → 27 Oct: 99 → 101.25
    expect(c.from).toBeCloseTo(99);
    expect(c.to).toBeCloseTo(101.25);
    expect(c.pct).toBeCloseTo(2.2727, 3);
    expect(changeOver(series, 'EUR', 'INR', 30, '2026-10-27')).toBeNull(); // no rate that early
  });

  it('compares a transfer with the market: what the rate cost or gained', () => {
    // 1,000 € sent on Monday, ₹99,800 received; the ECB said 100.8 → ₹1,00,800
    const t = compareTransfer(
      { date: '2026-10-26', from: 'EUR', to: 'INR', sent: 100_000, received: 9_980_000 },
      series,
    )!;
    expect(t.yourRate).toBeCloseTo(99.8);
    expect(t.marketRate).toBeCloseTo(100.8);
    expect(t.diffPct).toBeCloseTo(-0.992, 2);
    expect(t.diff).toBe(-100_000); // ₹1,000 less than at the market rate
    // the other way: ₹1,00,000 → 980 € on Tuesday (market: 987.65 €)
    const back = compareTransfer(
      { date: '2026-10-27', from: 'INR', to: 'EUR', sent: 10_000_000, received: 98_000 },
      series,
    )!;
    expect(back.yourRate).toBeCloseTo(102.04, 2); // rupees per euro, the way it is quoted
    expect(back.marketRate).toBeCloseTo(101.25);
    expect(back.diff).toBe(98_000 - 98_765);
    // no rate yet that day or before: nothing to compare
    expect(
      compareTransfer(
        { date: '2026-10-01', from: 'EUR', to: 'INR', sent: 1, received: 1 },
        series,
      ),
    ).toBeNull();
  });
});

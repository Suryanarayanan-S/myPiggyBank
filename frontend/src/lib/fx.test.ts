import { describe, expect, it } from 'vitest';
import { PAIRS, bandTicks, inRange, indexed, pairRate, since, type FxPoint } from './fx';

const p = (date: string, usdPerEur: number, inrPerEur: number): FxPoint => ({
  date,
  usdPerEur,
  inrPerEur,
});
const series = [
  p('2025-10-27', 1.0, 90),
  p('2026-09-27', 1.1, 99),
  p('2026-10-23', 1.1, 99),
  p('2026-10-26', 1.12, 100.8),
  p('2026-10-27', 1.125, 101.25),
];

describe('fx (page)', () => {
  it('rates of the three pairs', () => {
    const [eurInr, usdInr, eurUsd] = PAIRS;
    expect(pairRate(series[4]!, eurInr!)).toBeCloseTo(101.25);
    expect(pairRate(series[4]!, usdInr!)).toBeCloseTo(90);
    expect(pairRate(series[4]!, eurUsd!)).toBeCloseTo(1.125);
  });

  it('the points of a range, from the last one on or before its start', () => {
    expect(inRange(series, '1M').map((x) => x.date)).toEqual([
      '2026-09-27',
      '2026-10-23',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(inRange(series, 'all')).toHaveLength(5);
  });

  it('change since a point: the last published before (a day, a month, a year)', () => {
    const [eurInr] = PAIRS;
    expect(since(series, eurInr!, 'day')!.pct).toBeCloseTo(0.4464, 3); // 100.8 → 101.25
    expect(since(series, eurInr!, 'month')!.pct).toBeCloseTo(2.2727, 3); // 99 → 101.25
    expect(since(series, eurInr!, 'year')!.pct).toBeCloseTo(12.5, 3); // 90 → 101.25
    expect(since(series.slice(0, 1), eurInr!, 'day')).toBeNull();
  });

  it("a rate's axis fits its own band, not from zero", () => {
    expect(bandTicks(95.2, 100.8)).toEqual([94, 96, 98, 100, 102]);
    expect(bandTicks(1.101, 1.125)).toEqual([1.1, 1.105, 1.11, 1.115, 1.12, 1.125]);
    expect(bandTicks(90, 90)).toEqual([89, 89.5, 90, 90.5, 91]); // one value: a band around it
  });

  it('indexes each pair to the range start, to compare their moves', () => {
    const rows = indexed(inRange(series, '1M'));
    expect(rows[0]).toEqual({ date: '2026-09-27', EURINR: 0, USDINR: 0, EURUSD: 0 });
    expect(rows.at(-1)!.EURINR).toBeCloseTo(2.2727, 3);
    expect(rows.at(-1)!.EURUSD).toBeCloseTo(2.2727, 3); // 1.1 → 1.125
    expect(rows.at(-1)!.USDINR).toBeCloseTo(0, 6); // 90 → 90
  });
});

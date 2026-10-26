import { describe, expect, it } from 'vitest';
import { estimateIndianGold } from '../../src/domain/goldEstimate.js';

const day = (n: number) =>
  new Date(Date.UTC(2021, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

describe('Indian gold before IBJA’s first stored day, from GOLDBEES', () => {
  // GOLDBEES weekly for 4 years; real IBJA only at the end
  const goldbees = Array.from({ length: 210 }, (_, i) => ({
    date: day(i * 7),
    value: 40 + i * 0.2,
  }));
  const end = goldbees.at(-1)!;

  it('scales GOLDBEES by the ratio of the stored days when there is nothing older', () => {
    const r = estimateIndianGold({
      goldbees,
      k24: [{ date: end.date, value: end.value * 120 }],
      k22: [{ date: end.date, value: end.value * 110 }],
      anchors: [],
    });
    expect(r.k24[0]).toEqual({ date: day(0), value: 40 * 120 });
    expect(r.k22[0]!.value).toBeCloseTo(40 * 110, 6);
    // only before the first real day
    expect(r.k24.at(-1)!.date < end.date).toBe(true);
    expect(r.until).toBe(end.date);
  });

  it('follows the drift the gold bond prices show (the fund’s costs)', () => {
    // the true ratio grows from 118 to 122 over the years; anchors sit 12 days before issues
    const ratio = (i: number) => 118 + (4 * i) / 209;
    const anchors = [10, 60, 110, 160].map((i) => ({
      date: day(i * 7 + 12), // the issue date: priced 12 days before
      value: goldbees[i]!.value * ratio(i),
    }));
    const r = estimateIndianGold({
      goldbees,
      k24: [{ date: end.date, value: end.value * ratio(209) }],
      k22: [{ date: end.date, value: end.value * ratio(209) * 0.916 }],
      anchors,
    });
    const at = (i: number) => r.k24.find((p) => p.date === day(i * 7))!.value;
    expect(at(10) / goldbees[10]!.value).toBeCloseTo(ratio(10), 1);
    expect(at(110) / goldbees[110]!.value).toBeCloseTo(ratio(110), 1);
  });

  it('gives nothing without a stored IBJA day', () => {
    expect(estimateIndianGold({ goldbees, k24: [], k22: [], anchors: [] })).toEqual({
      k24: [],
      k22: [],
      until: null,
    });
  });
});

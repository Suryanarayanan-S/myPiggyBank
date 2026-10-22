import { describe, expect, it } from 'vitest';
import { goldBond, goldBondInterest, interestPaise } from '../src/domain/goldBonds.js';

describe('gold bond interest', () => {
  it('knows each series by its NSE symbol', () => {
    expect(goldBond('SGBAUG28V')).toEqual({ issued: '2020-08-11', price: 5334 });
    expect(goldBond('SGBDE30III')).toEqual({ issued: '2022-12-27', price: 5409 });
    expect(goldBond('SGBNOV258')).toEqual({ issued: '2017-11-20', price: 2961 });
    expect(goldBond('GOLDBEES')).toBeNull();
  });

  it('pays 2.5% a year of the issue price every six months, recorded 15 days before', () => {
    // as Console lists them: ex-date, interest a bond (micros)
    expect(goldBondInterest('SGBAUG28V', '2025-06-01', '2026-10-22')).toEqual([
      { exDate: '2025-07-27', perUnit: 66_675_000 },
      { exDate: '2026-01-27', perUnit: 66_675_000 },
      { exDate: '2026-07-27', perUnit: 66_675_000 },
    ]);
    // Feb 21 and Aug 21: the first one six months after the issue
    expect(goldBondInterest('SGBFEB32IV', '2024-02-21', '2025-03-01').map((p) => p.exDate)).toEqual(
      ['2024-08-06', '2025-02-06'],
    );
    expect(goldBondInterest('UNKNOWN', '2020-01-01', '2026-01-01')).toEqual([]);
  });

  it('stops at maturity, eight years after the issue', () => {
    const all = goldBondInterest('SGBNOV23', '2015-01-01', '2026-10-22');
    expect(all).toHaveLength(16);
    expect(all.at(-1)!.exDate).toBe('2023-11-15');
  });

  it('rounds down to the paisa, as Console does', () => {
    // 3 × 66.675 = 200.025 → ₹200.02; 2 × 67.6125 = 135.225 → ₹135.22
    expect(interestPaise(3_000_000, 66_675_000)).toBe(20_002);
    expect(interestPaise(2_000_000, 67_612_500)).toBe(13_522);
    expect(interestPaise(8_000_000, 78_287_500)).toBe(62_630);
  });
});

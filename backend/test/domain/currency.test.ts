import { describe, expect, it } from 'vitest';
import { convert, findRate, formatRate, parseRate, type Rate } from '../../src/domain/currency.js';

const rates: Rate[] = [
  { month: '2026-08', base: 'EUR', quote: 'INR', rateMicros: 96_500_000 },
  { month: '2026-09', base: 'EUR', quote: 'INR', rateMicros: 97_855_000 },
  { month: '2026-11', base: 'EUR', quote: 'INR', rateMicros: 99_000_000 },
];

describe('parseRate / formatRate', () => {
  it.each([
    ['97.85', 97_850_000],
    ['97,85', 97_850_000],
    [' 1 ', 1_000_000],
    ['0.011', 11_000],
  ])('parses %j', (s, micros) => expect(parseRate(s)).toBe(micros));

  it.each(['0', '-1', 'abc', '', '1.1234567', '1,000.5'])('rejects %j', (s) =>
    expect(parseRate(s)).toBeNull(),
  );

  it('formats micros without trailing zeros', () => {
    expect(formatRate(97_850_000)).toBe('97.85');
    expect(formatRate(1_000_000)).toBe('1');
    expect(formatRate(11_000)).toBe('0.011');
  });
});

describe('findRate', () => {
  it('is 1 for the same currency', () => {
    expect(findRate([], '2026-10', 'EUR', 'EUR')).toBe(1_000_000);
  });
  it('uses the exact month when present', () => {
    expect(findRate(rates, '2026-09', 'EUR', 'INR')).toBe(97_855_000);
  });
  it('falls back to the latest earlier month, never a later one', () => {
    expect(findRate(rates, '2026-10', 'EUR', 'INR')).toBe(97_855_000);
    expect(findRate(rates, '2026-07', 'EUR', 'INR')).toBeNull();
  });
  it('inverts a reverse pair', () => {
    expect(findRate(rates, '2026-09', 'INR', 'EUR')).toBe(Math.round(1e12 / 97_855_000));
  });
  it('returns null when no rate exists for the pair', () => {
    expect(findRate(rates, '2026-09', 'EUR', 'USD')).toBeNull();
  });
});

describe('convert', () => {
  it('converts with rounding half away from zero', () => {
    expect(convert(100, 'EUR', 'INR', '2026-09', rates)).toBe(9786); // 97.855 → 97.86
    expect(convert(-100, 'EUR', 'INR', '2026-09', rates)).toBe(-9786);
  });
  it('returns the amount unchanged for the same currency', () => {
    expect(convert(5240, 'EUR', 'EUR', '2026-09', [])).toBe(5240);
  });
  it('returns null when no rate is available', () => {
    expect(convert(100, 'EUR', 'GBP', '2026-09', rates)).toBeNull();
  });
});

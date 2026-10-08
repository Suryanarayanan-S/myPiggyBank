import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  convert,
  expandLiveRates,
  findRate,
  formatRate,
  mergeRates,
  parseRate,
  type Rate,
} from '../../src/domain/currency.js';

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

describe('CURRENCIES', () => {
  it('covers the ECB set the family may use', () => {
    expect([...CURRENCIES]).toEqual(['EUR', 'INR', 'USD', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD']);
  });
});

describe('expandLiveRates', () => {
  const live = [
    { month: '2026-09', quote: 'INR', rateMicros: 100_000_000 },
    { month: '2026-09', quote: 'USD', rateMicros: 1_250_000 },
  ];
  const rates = expandLiveRates(live);

  it('keeps EUR → X', () => {
    expect(findRate(rates, '2026-09', 'EUR', 'INR')).toBe(100_000_000);
  });
  it('derives cross rates through EUR', () => {
    expect(findRate(rates, '2026-09', 'USD', 'INR')).toBe(80_000_000);
    expect(findRate(rates, '2026-09', 'INR', 'USD')).toBe(12_500);
  });
  it('keeps months apart', () => {
    const r = expandLiveRates([
      ...live,
      { month: '2026-10', quote: 'INR', rateMicros: 90_000_000 },
    ]);
    expect(findRate(r, '2026-10', 'EUR', 'INR')).toBe(90_000_000);
    expect(findRate(r, '2026-10', 'USD', 'INR')).toBe(80_000_000); // USD falls back to September
  });
});

describe('mergeRates', () => {
  const live = expandLiveRates([
    { month: '2026-09', quote: 'INR', rateMicros: 100_000_000 },
    { month: '2026-10', quote: 'INR', rateMicros: 101_000_000 },
  ]);
  const manual = [{ month: '2026-09', base: 'INR', quote: 'EUR', rateMicros: 10_000 }];
  const rates = mergeRates(manual, live);

  it('lets a hand-entered rate win for its month, whichever direction it was entered in', () => {
    expect(findRate(rates, '2026-09', 'EUR', 'INR')).toBe(100_000_000);
    expect(findRate(rates, '2026-09', 'INR', 'EUR')).toBe(10_000);
  });
  it('uses the live rate for other months', () => {
    expect(findRate(rates, '2026-10', 'EUR', 'INR')).toBe(101_000_000);
  });
  it('drops the overridden live row', () => {
    expect(rates.filter((r) => r.month === '2026-09')).toEqual(manual);
  });
});

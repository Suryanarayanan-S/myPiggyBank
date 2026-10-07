import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoneyInput } from './money';

describe('formatMoney', () => {
  it('formats cents as German-locale euros by default', () => {
    expect(formatMoney(5240)).toBe('52,40 €');
    expect(formatMoney(12845000)).toBe('128.450,00 €');
    expect(formatMoney(-120000)).toBe('-1.200,00 €');
  });
  it('respects currency and locale', () => {
    expect(formatMoney(541600, 'USD', 'en-US')).toBe('$5,416.00');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['52,40', 5240],
    ['52.40', 5240],
    ['52,4', 5240],
    ['1234', 123400],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234', 123400],
    [' 5416 € ', 541600],
    ['-12,50', -1250],
    ['0', 0],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseMoneyInput(input)).toBe(cents);
  });

  it.each(['', 'abc', '12,345,67', '1.2.3', ',50', '12,', '1,234,5', '1.234,567'])(
    'rejects %j',
    (input) => {
      expect(parseMoneyInput(input)).toBeNull();
    },
  );
});

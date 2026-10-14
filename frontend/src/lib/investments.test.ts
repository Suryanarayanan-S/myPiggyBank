import { describe, expect, it } from 'vitest';
import { formatPrice, formatUnits, normaliseDecimal } from './investments';

describe('normaliseDecimal', () => {
  it('accepts up to 6 decimals with a comma or a point', () => {
    expect(normaliseDecimal('12,5')).toBe('12.5');
    expect(normaliseDecimal(' 98.4567 ')).toBe('98.4567');
    expect(normaliseDecimal('0.000001')).toBe('0.000001');
  });
  it('refuses zero, signs, thousands separators and too many decimals', () => {
    for (const bad of ['0', '-1', '1.234.5', '1,000.5', '1.1234567', 'ten', ''])
      expect(normaliseDecimal(bad)).toBeNull();
  });
});

describe('formatUnits', () => {
  it('shows units the German way with only the decimals needed', () => {
    expect(formatUnits('12.5')).toBe('12,5');
    expect(formatUnits('1500')).toBe('1.500');
    expect(formatUnits('0.000001')).toBe('0,000001');
  });
});

describe('numbers in the holding’s own style', () => {
  it('writes units and prices the way the currency is usually written', () => {
    expect(formatUnits('5030', 'INR')).toBe('5,030');
    expect(formatUnits('12.5', 'EUR')).toBe('12,5');
    expect(formatPrice('62.206678', 'INR')).toBe('62.21');
    expect(formatPrice('120.5', 'EUR')).toBe('120,50');
  });
});

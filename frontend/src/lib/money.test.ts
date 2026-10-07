import { describe, expect, it } from 'vitest';
import { formatCompact, formatMoney, parseAmountInput, parseMoneyInput } from './money';

describe('formatMoney', () => {
  it('formats cents as German-locale euros by default', () => {
    expect(formatMoney(5240)).toBe('52,40 €');
    expect(formatMoney(12845000)).toBe('128.450,00 €');
    expect(formatMoney(-120000)).toBe('-1.200,00 €');
  });
  it('uses Indian digit grouping for INR', () => {
    expect(formatMoney(800000000, 'INR')).toBe('₹80,00,000.00');
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
    ['1,00,000', 10000000],
    ['80,00,000.00', 800000000],
    ['₹1,23,45,678.50', 1234567850],
  ])('parses %j as %i cents', (input, cents) => {
    expect(parseMoneyInput(input)).toBe(cents);
  });

  it.each([
    '',
    'abc',
    '12,345,67',
    '1.2.3',
    ',50',
    '12,',
    '1,234,5',
    '1.234,567',
    '1,00,00',
    '1,0,000',
  ])('rejects %j', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });
});

describe('formatCompact', () => {
  it('uses lakh and crore for INR', () => {
    expect(formatCompact(800000000, 'INR')).toBe('₹80 L');
    expect(formatCompact(1200000000, 'INR')).toBe('₹1.2 Cr');
    expect(formatCompact(250000000, 'INR')).toBe('₹25 L');
    expect(formatCompact(500000, 'INR')).toBe('₹5,000');
  });
  it('uses k and M for other currencies', () => {
    expect(formatCompact(12845000, 'EUR')).toBe('€128.5k');
    expect(formatCompact(250000000, 'USD')).toBe('$2.5M');
    expect(formatCompact(52400, 'EUR')).toBe('€524');
    expect(formatCompact(-12845000, 'EUR')).toBe('-€128.5k');
  });
});

describe('parseAmountInput (lakh / crore)', () => {
  it.each([
    ['80 L', 800_000_000],
    ['80L', 800_000_000],
    ['80 lakh', 800_000_000],
    ['80 lakhs', 800_000_000],
    ['4.5 lac', 45_000_000],
    ['₹25 L', 250_000_000],
    ['1.2 Cr', 1_200_000_000],
    ['1,2 Cr', 1_200_000_000],
    ['0.5 crore', 500_000_000],
    ['25,00,000', 250_000_000],
    ['52,40', 5_240],
  ])('%j → %i', (input, cents) => {
    expect(parseAmountInput(input)).toBe(cents);
  });

  it.each(['L', 'Cr', '80 X', '1.2.3 Cr', '-', '1.234 L'])('rejects %j', (input) => {
    expect(parseAmountInput(input)).toBeNull();
  });
});

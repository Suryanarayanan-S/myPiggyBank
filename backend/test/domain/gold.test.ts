import { describe, expect, it } from 'vitest';
import { goldValue, parseGrams } from '../../src/domain/gold.js';

// IBJA 999 rate on 21 Oct 2026: ₹14,410.50 a gram
const RATE = 14_410_500_000;

describe('physical gold', () => {
  it('is worth its weight at the day’s rate, by purity', () => {
    expect(goldValue(10_000, '24k', RATE)).toBe(14_410_500); // 10 g → ₹1,44,105
    expect(goldValue(10_000, '22k', RATE)).toBe(13_200_018); // × 0.916 (IBJA's 22K rate)
    expect(goldValue(8_000, '18k', RATE)).toBe(8_646_300); // 8 g × 0.75
    expect(goldValue(1_000_000, '24k', RATE)).toBe(1_441_050_000); // a kilogram, exactly
  });

  it('reads grams', () => {
    expect(parseGrams('12.5')).toBe(12_500);
    expect(parseGrams('8,345')).toBe(8_345);
    expect(parseGrams('0')).toBeNull();
    expect(parseGrams('1.2345')).toBeNull();
    expect(parseGrams('abc')).toBeNull();
  });
});

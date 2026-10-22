import { describe, expect, it } from 'vitest';
import { formatGrams, normaliseGrams } from './gold';

describe('gold', () => {
  it('reads grams', () => {
    expect(normaliseGrams('12.5')).toBe('12.5');
    expect(normaliseGrams('8,345')).toBe('8.345');
    expect(normaliseGrams('10 g')).toBe('10');
    expect(normaliseGrams('0')).toBeNull();
    expect(normaliseGrams('1.2345')).toBeNull();
    expect(normaliseGrams('ten')).toBeNull();
  });

  it('writes grams', () => {
    expect(formatGrams('12.5')).toBe('12.5 g');
    expect(formatGrams('1250')).toBe('1,250 g');
  });
});

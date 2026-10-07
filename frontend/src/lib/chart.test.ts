import { describe, expect, it } from 'vitest';
import { niceTicks, shortMonth } from './chart';

describe('niceTicks', () => {
  it('covers the data with round steps from zero', () => {
    expect(niceTicks(375_000)).toEqual([0, 100_000, 200_000, 300_000, 400_000]);
    expect(niceTicks(290_000)).toEqual([0, 100_000, 200_000, 300_000]);
    expect(niceTicks(7_600)).toEqual([0, 2_000, 4_000, 6_000, 8_000]);
    expect(niceTicks(1_250)).toEqual([0, 500, 1_000, 1_500]);
  });
  it('includes negative values when the data goes below zero', () => {
    expect(niceTicks(10_000, -3_000)).toEqual([-5_000, 0, 5_000, 10_000]);
  });
  it('handles an empty or zero range', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe('shortMonth', () => {
  it('uses three-letter months', () => {
    expect(shortMonth('2026-09')).toBe('Sep 26');
    expect(shortMonth('2026-08')).toBe('Aug 26');
  });
});

import { describe, expect, it } from 'vitest';
import { nearGroups, niceTicks, shortMonth, spreadLabels } from './chart';

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

describe('spreadLabels', () => {
  it('keeps labels that are apart where they are', () => {
    expect(spreadLabels([10, 50, 100], 12)).toEqual([10, 50, 100]);
  });
  it('pushes labels apart around their middle, keeping their order', () => {
    // two on the same spot: one moves up, one down
    expect(spreadLabels([50, 50], 12)).toEqual([44, 56]);
    // given in any order; the result is in the same order as given
    expect(spreadLabels([60, 50, 55], 12)).toEqual([67, 43, 55]);
  });
  it('keeps them inside the plot', () => {
    expect(spreadLabels([0, 1], 12, 0, 100)).toEqual([0, 12]);
    expect(spreadLabels([100, 99], 12, 0, 100)).toEqual([100, 88]);
  });
});

describe('nearGroups', () => {
  it('groups labels close enough side by side to touch', () => {
    expect(nearGroups([300, 100, 290, 295], 60)).toEqual([[1], [2, 3, 0]]);
    expect(nearGroups([0, 50, 100, 200], 60)).toEqual([[0, 1, 2], [3]]);
    expect(nearGroups([], 60)).toEqual([]);
  });
});

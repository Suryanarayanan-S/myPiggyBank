import { describe, expect, it } from 'vitest';
import { addSeries, fromFirstValue } from './history';

describe('value over time', () => {
  it('adds series day by day', () => {
    expect(addSeries(3, [[1, 2, 3], undefined, [10, 10, 10]])).toEqual([11, 12, 13]);
  });

  it('starts where there was something, from one zero before it', () => {
    const id = (v: number) => v;
    expect(fromFirstValue([0, 0, 0, 5, 6], id)).toEqual([0, 5, 6]);
    expect(fromFirstValue([3, 0, 4], id)).toEqual([3, 0, 4]);
    expect(fromFirstValue([0, 0], id)).toEqual([0, 0]);
  });
});

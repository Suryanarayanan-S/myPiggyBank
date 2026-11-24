import { describe, expect, it } from 'vitest';
import { addSeries, fromFirstValue, pointsIn, rangeFrom } from './history';

describe('value over time', () => {
  it('adds series day by day', () => {
    expect(addSeries(3, [[1, 2, 3], undefined, [10, 10, 10]])).toEqual([11, 12, 13]);
  });

  it('starts a range a month, six months or a year back', () => {
    expect(rangeFrom('1m', '2026-11-24')).toBe('2026-10-24');
    expect(rangeFrom('1y', '2026-11-24')).toBe('2025-11-24');
    expect(rangeFrom('all', '2026-11-24')).toBeNull();
    expect(rangeFrom('1m', '2026-03-31')).toBe('2026-02-28');
  });

  it('keeps the dated points of the range and ends with today', () => {
    const snaps = [
      { date: '2026-01-31', value: 1 },
      { date: '2025-06-30', value: 0 },
      { date: '2026-11-24', value: 5 }, // today's snapshot: today's value wins
    ];
    const today = { date: '2026-11-24', value: 7 };
    // the snapshot before the range starts the line on its first day
    expect(pointsIn(snaps, '2025-11-24', today)).toEqual([
      { date: '2025-11-24', value: 0 },
      { date: '2026-01-31', value: 1 },
      today,
    ]);
    expect(pointsIn(snaps, '2026-10-24', today)).toEqual([{ date: '2026-10-24', value: 1 }, today]);
    expect(pointsIn(snaps, null, today).map((p) => p.value)).toEqual([0, 1, 7]);
  });

  it('starts where there was something, from one zero before it', () => {
    const id = (v: number) => v;
    expect(fromFirstValue([0, 0, 0, 5, 6], id)).toEqual([0, 5, 6]);
    expect(fromFirstValue([3, 0, 4], id)).toEqual([3, 0, 4]);
    expect(fromFirstValue([0, 0], id)).toEqual([0, 0]);
  });
});

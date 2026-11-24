import { describe, expect, it } from 'vitest';
import { dayGrid, rangeStart } from '../../src/domain/history.js';

describe('value-over-time days', () => {
  it('goes back a month, six months or a year; everything from the first day', () => {
    expect(rangeStart('1m', '2026-03-31', null)).toBe('2026-02-28'); // the month's last day
    expect(rangeStart('6m', '2026-08-31', null)).toBe('2026-02-28');
    expect(rangeStart('6m', '2026-11-24', null)).toBe('2026-05-24');
    expect(rangeStart('1y', '2026-11-24', null)).toBe('2025-11-24');
    expect(rangeStart('all', '2026-11-24', '2019-04-01')).toBe('2019-04-01');
    expect(rangeStart('all', '2026-11-24', null)).toBe('2025-11-24');
  });

  it('every day for a month, spaced out for longer, always from the start to today', () => {
    const month = dayGrid('2026-10-24', '2026-11-24');
    expect(month).toHaveLength(32);
    expect(month[0]).toBe('2026-10-24');
    expect(month.at(-1)).toBe('2026-11-24');
    const years = dayGrid('2019-04-01', '2026-11-24');
    expect(years.length).toBeLessThanOrEqual(202);
    expect(years[0]).toBe('2019-04-01');
    expect(years.at(-1)).toBe('2026-11-24');
    expect(dayGrid('2026-11-24', '2026-11-24')).toEqual(['2026-11-24']);
  });
});

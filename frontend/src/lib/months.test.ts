import { describe, expect, it } from 'vitest';
import { localDay, localMonth, monthEnd, monthTitle, shiftMonth } from './months';

describe('month helpers', () => {
  it('uses local time, not UTC, for today and the current month', () => {
    const justAfterMidnight = new Date(2026, 9, 1, 0, 30); // 1 Oct 2026 00:30 local
    expect(localMonth(justAfterMidnight)).toBe('2026-10');
    expect(localDay(justAfterMidnight)).toBe('2026-10-01');
  });
  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -13)).toBe('2025-09');
  });
  it('knows the last day of a month, including leap years', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    expect(monthEnd('2026-10')).toBe('2026-10-31');
  });
  it('titles a month', () => {
    expect(monthTitle('2026-09')).toBe('September 2026');
  });
});

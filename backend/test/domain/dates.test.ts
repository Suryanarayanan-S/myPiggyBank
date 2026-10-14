import { describe, expect, it } from 'vitest';
import { addDays, todayLocal } from '../../src/lib/dates.js';

describe('todayLocal', () => {
  it('is the calendar day where the family lives, not in UTC', () => {
    const lateEvening = new Date('2026-10-13T22:30:00Z'); // 00:30 on the 14th in Berlin
    expect(todayLocal(lateEvening, 'Europe/Berlin')).toBe('2026-10-14');
    expect(todayLocal(lateEvening, 'UTC')).toBe('2026-10-13');
  });
});

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

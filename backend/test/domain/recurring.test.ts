import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrences } from '../../src/domain/recurring.js';

const rule = (
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  startDate: string,
  endDate: string | null = null,
) => ({
  frequency,
  startDate,
  endDate,
});

describe('occurrences', () => {
  it('monthly on the 31st clamps to the last day of shorter months', () => {
    expect(occurrences(rule('monthly', '2026-01-31'), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrences(rule('monthly', '2027-12-31'), '2028-02-01', '2028-02-29')).toEqual([
      '2028-02-29',
    ]);
  });

  it('weekly, quarterly and yearly (29 Feb → 28 Feb in normal years)', () => {
    expect(occurrences(rule('weekly', '2026-10-01'), '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
    expect(occurrences(rule('quarterly', '2026-01-15'), '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
    expect(occurrences(rule('yearly', '2024-02-29'), '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29',
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('respects the window, the start date and the end date', () => {
    expect(
      occurrences(rule('monthly', '2026-03-05', '2026-06-04'), '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-03-05', '2026-04-05', '2026-05-05']);
    expect(occurrences(rule('monthly', '2026-03-05'), '2026-04-06', '2026-05-04')).toEqual([]);
  });

  it('finds the next occurrence after a date', () => {
    expect(nextOccurrence(rule('monthly', '2026-01-31'), '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(rule('monthly', '2026-01-31', '2026-03-01'), '2026-02-28')).toBeNull();
  });
});

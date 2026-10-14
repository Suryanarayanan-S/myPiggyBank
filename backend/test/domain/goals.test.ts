import { describe, expect, it } from 'vitest';
import { goalProgress, monthsUntil } from '../../src/domain/goals.js';

const base = { target: 1_000_000, today: '2026-10-14' };

describe('monthsUntil', () => {
  it('counts whole months, at least one', () => {
    expect(monthsUntil('2026-10-14', '2027-10-14')).toBe(12);
    expect(monthsUntil('2026-10-14', '2027-10-13')).toBe(11);
    expect(monthsUntil('2026-10-14', '2026-10-20')).toBe(1);
    expect(monthsUntil('2026-01-31', '2026-02-28')).toBe(1);
  });
});

describe('goalProgress', () => {
  it('without a target date: share and amount left only', () => {
    const p = goalProgress({ ...base, saved: 250_000, savedBefore: 100_000, targetDate: null });
    expect(p).toEqual({
      pctBp: 2500,
      left: 750_000,
      pace: 50_000,
      monthsLeft: null,
      monthlyNeeded: null,
      onTrack: null,
      reached: false,
      overdue: false,
    });
  });

  it('with a date: monthly amount needed rounds up; on track when the pace covers it', () => {
    const p = goalProgress({
      ...base,
      saved: 400_000,
      savedBefore: 250_000,
      targetDate: '2027-10-14',
    });
    expect(p.monthsLeft).toBe(12);
    expect(p.monthlyNeeded).toBe(50_000); // 600,000 / 12
    expect(p.pace).toBe(50_000); // 150,000 over 3 months
    expect(p.onTrack).toBe(true);
    const odd = goalProgress({ ...base, saved: 0, savedBefore: 0, targetDate: '2027-01-14' });
    expect(odd.monthlyNeeded).toBe(333_334);
    expect(odd.onTrack).toBe(false);
  });

  it('reached: nothing left, on track, no need', () => {
    const p = goalProgress({
      ...base,
      saved: 1_200_000,
      savedBefore: 900_000,
      targetDate: '2026-12-01',
    });
    expect(p).toMatchObject({
      pctBp: 12_000,
      left: 0,
      monthlyNeeded: 0,
      onTrack: true,
      reached: true,
    });
  });

  it('a past date that was not reached is overdue', () => {
    const p = goalProgress({
      ...base,
      saved: 500_000,
      savedBefore: 500_000,
      targetDate: '2026-09-30',
    });
    expect(p).toMatchObject({
      overdue: true,
      onTrack: false,
      monthlyNeeded: 500_000,
      monthsLeft: 0,
    });
  });

  it('a shrinking pot has a negative pace and is behind', () => {
    const p = goalProgress({
      ...base,
      saved: 100_000,
      savedBefore: 400_000,
      targetDate: '2027-10-14',
    });
    expect(p.pace).toBe(-100_000);
    expect(p.onTrack).toBe(false);
  });
});

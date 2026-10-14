import { describe, expect, it } from 'vitest';
import { goalStatus, type Goal } from './goals';

const p = (over: Partial<Goal['progress']>): Goal['progress'] => ({
  pctBp: 5000,
  left: 500_000,
  pace: 10_000,
  monthsLeft: 10,
  monthlyNeeded: 50_000,
  onTrack: false,
  reached: false,
  overdue: false,
  ...over,
});

describe('goalStatus', () => {
  it('names each state with a tone, never by colour alone', () => {
    expect(goalStatus(p({ reached: true, onTrack: true }))).toEqual({
      label: 'Reached',
      tone: 'good',
    });
    expect(goalStatus(p({ onTrack: true }))).toEqual({ label: 'On track', tone: 'good' });
    expect(goalStatus(p({ onTrack: false }))).toEqual({ label: 'Behind', tone: 'warn' });
    expect(goalStatus(p({ overdue: true }))).toEqual({ label: 'Past its date', tone: 'bad' });
    expect(goalStatus(p({ onTrack: null, monthlyNeeded: null }))).toEqual({
      label: 'No date',
      tone: 'neutral',
    });
  });
});

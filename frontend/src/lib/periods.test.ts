import { describe, expect, it } from 'vitest';
import { periodRange } from './periods';

describe('periodRange', () => {
  const today = '2026-10';
  it.each([
    ['this-month', { from: '2026-10', to: '2026-10' }],
    ['last-month', { from: '2026-09', to: '2026-09' }],
    ['last-3', { from: '2026-08', to: '2026-10' }],
    ['this-year', { from: '2026-01', to: '2026-10' }],
    ['last-12', { from: '2025-11', to: '2026-10' }],
  ] as const)('%s', (preset, range) => {
    expect(periodRange(preset, today, null)).toEqual(range);
  });

  it('all time starts at the first recorded month', () => {
    expect(periodRange('all', today, '2023-11')).toEqual({ from: '2023-11', to: '2026-10' });
    expect(periodRange('all', today, null)).toEqual({ from: '2026-10', to: '2026-10' });
  });

  it('all time is capped at 120 months', () => {
    expect(periodRange('all', today, '2001-01')).toEqual({ from: '2016-11', to: '2026-10' });
  });

  it('custom ranges are ordered and capped', () => {
    expect(periodRange('custom', today, null, { from: '2026-05', to: '2026-02' })).toEqual({
      from: '2026-02',
      to: '2026-05',
    });
    expect(periodRange('custom', today, null, { from: '2000-01', to: '2026-10' })).toEqual({
      from: '2016-11',
      to: '2026-10',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { formatPercent } from './percent';

describe('formatPercent', () => {
  it('formats basis points with one decimal', () => {
    expect(formatPercent(2101)).toBe('21.0 %');
    expect(formatPercent(7600)).toBe('76.0 %');
    expect(formatPercent(10133)).toBe('101.3 %');
    expect(formatPercent(-250)).toBe('-2.5 %');
  });
  it('shows a dash when there is nothing to compare against', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

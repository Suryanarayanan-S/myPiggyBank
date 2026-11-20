import { describe, expect, it } from 'vitest';
import { byName, leftOutNotes, signedPercent } from './returns';

describe('returns', () => {
  it('writes a rate with its sign', () => {
    expect(signedPercent(725)).toBe('+7.3 %');
    expect(signedPercent(-300)).toBe('−3.0 %');
    expect(signedPercent(0)).toBe('0.0 %');
    expect(signedPercent(null)).toBe('—');
  });

  it('says what was left out', () => {
    expect(leftOutNotes({ leftOut: { market: 0, gold: 0 } })).toEqual([]);
    expect(leftOutNotes({ leftOut: { market: 1, gold: 2 } })).toEqual([
      '1 holding without a price yet',
      '2 pieces of gold without the price paid or the day bought (or no gold rate yet)',
    ]);
  });

  it('adds the payments up per holding, largest first', () => {
    const l = (name: string, amount: number) => ({
      date: '2026-01-01',
      name,
      income: false,
      amount,
      own: null,
    });
    expect(byName([l('A', 10), l('B', 50), l('A', 45)])).toEqual([
      { name: 'A', amount: 55, count: 2 },
      { name: 'B', amount: 50, count: 1 },
    ]);
  });
});

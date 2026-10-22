import { describe, expect, it } from 'vitest';
import { formatRateBp, maturingSoon, parseRatePercent, whenLeft, type Deposit } from './deposits';

const d = (name: string, status: Deposit['status'], daysLeft: number) =>
  ({ name, status, daysLeft }) as Deposit;

describe('deposits', () => {
  it('reads and writes yearly rates', () => {
    expect(parseRatePercent('7.25')).toBe(725);
    expect(parseRatePercent('7,1')).toBe(710);
    expect(parseRatePercent('6.5 %')).toBe(650);
    expect(parseRatePercent('0')).toBeNull();
    expect(parseRatePercent('7.255')).toBeNull();
    expect(parseRatePercent('abc')).toBeNull();
    expect(parseRatePercent('60')).toBeNull();
    expect(formatRateBp(725)).toBe('7.25 %');
    expect(formatRateBp(700)).toBe('7 %');
  });

  it('lists what matures soon, matured-but-not-paid-out first', () => {
    const list = [
      d('Later', 'active', 200),
      d('Soon', 'active', 12),
      d('Due', 'matured', -3),
      d('Paid', 'closed', -40),
      d('Not started', 'upcoming', 30),
    ];
    expect(maturingSoon(list).map((x) => x.name)).toEqual(['Due', 'Soon']);
  });

  it('says when', () => {
    expect([whenLeft(0), whenLeft(1), whenLeft(12), whenLeft(-1), whenLeft(-3)]).toEqual([
      'today',
      'tomorrow',
      'in 12 days',
      '1 day ago',
      '3 days ago',
    ]);
  });
});

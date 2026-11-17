import { describe, expect, it } from 'vitest';
import {
  depositCount,
  formatRateBp,
  linkableDeposits,
  maturingSoon,
  paidOutOn,
  withKindSuffix,
  parseRatePercent,
  whenLeft,
  type Deposit,
} from './deposits';

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
      { name: 'Tagesgeld', status: 'active', daysLeft: null } as Deposit,
    ];
    expect(maturingSoon(list).map((x) => x.name)).toEqual(['Due', 'Soon']);
  });

  it('names end with the kind, as the server saves them', () => {
    expect(withKindSuffix('HDFC', 'fd')).toBe('HDFC FD');
    expect(withKindSuffix('Tagesgeld', 'savings')).toBe('Tagesgeld Instant');
    expect(withKindSuffix('SBI rd ', 'rd')).toBe('SBI rd');
    expect(withKindSuffix('HDFC FD 2026', 'fd')).toBe('HDFC FD 2026');
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

  it('counts deposits by kind', () => {
    const k = (kind: Deposit['kind']) => ({ kind });
    expect(depositCount([k('fd')])).toBe('1 fixed deposit');
    expect(depositCount([k('fd'), k('rd'), k('fd')])).toBe('2 fixed deposits, 1 recurring deposit');
    expect(depositCount([])).toBe('');
    expect(depositCount([k('savings'), k('savings')])).toBe('2 instant-access accounts');
  });

  it('is paid out on the day its money came back, else at maturity or today', () => {
    const fd = (movements: Deposit['movements'], maturityDate = '2026-10-01') =>
      ({ movements, maturityDate }) as Deposit;
    const m = (date: string, amount: number) => ({
      transactionId: date,
      date,
      amount,
      label: null,
    });
    expect(paidOutOn(fd([m('2026-10-03', -500), m('2025-10-01', 500)]), '2026-11-17')).toBe(
      '2026-10-03',
    );
    expect(paidOutOn(fd([m('2025-10-01', 500)]), '2026-11-17')).toBe('2026-10-01');
    expect(paidOutOn(fd([], '2026-12-01'), '2026-11-17')).toBe('2026-11-17');
  });

  it('offers the open deposits in the transaction’s currency, and the one it has', () => {
    const dep = (id: string, currency: string, status: Deposit['status']) =>
      ({ id, currency, status }) as Deposit;
    const list = [
      dep('a', 'EUR', 'active'),
      dep('b', 'INR', 'active'),
      dep('c', 'EUR', 'closed'),
      dep('d', 'EUR', 'matured'),
    ];
    expect(linkableDeposits(list, 'EUR').map((x) => x.id)).toEqual(['a', 'd']);
    expect(linkableDeposits(list, 'EUR', 'c').map((x) => x.id)).toEqual(['a', 'c', 'd']);
    // moved to an account in another currency: its deposit is no longer offered
    expect(linkableDeposits(list, 'EUR', 'b').map((x) => x.id)).toEqual(['a', 'd']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  depositValue,
  instalmentsDue,
  maturityAmount,
  recurringMaturity,
  recurringValue,
  payoutPerPeriod,
  type DepositTerms,
  type RecurringTerms,
} from '../../src/domain/deposits.js';

// ₹1,00,000 at 7 % for a year, compounded quarterly (as most Indian banks do)
const fd: DepositTerms = {
  principal: 10_000_000,
  rateBp: 700,
  start: '2026-01-15',
  maturity: '2027-01-15',
  compounding: 'quarterly',
  interest: 'reinvest',
};

describe('fixed deposits', () => {
  it('adds months, keeping the day (or the month’s last day)', () => {
    expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('grows by compound interest per period, simple interest within a period', () => {
    expect(depositValue(fd, '2026-01-10')).toBeNull(); // not started yet
    expect(depositValue(fd, '2026-01-15')).toBe(10_000_000);
    // one quarter, then 30 of the next quarter's 91 days: 1,00,000 × 1.0175 × (1 + 0.0175 × 30/91)
    expect(depositValue(fd, '2026-05-15')).toBe(10_233_702);
    // at maturity: 1,00,000 × 1.0175⁴
    expect(maturityAmount(fd)).toBe(10_718_590);
    // after maturity it stays at the maturity amount (until paid out)
    expect(depositValue(fd, '2027-03-01')).toBe(10_718_590);
  });

  it('never dips when a period completes (a half-year can have 184 days)', () => {
    const half = {
      ...fd,
      start: '2026-07-01',
      maturity: '2028-07-01',
      rateBp: 725,
      compounding: 'half-yearly' as const,
    };
    expect(depositValue(half, '2027-01-01')!).toBeGreaterThanOrEqual(
      depositValue(half, '2026-12-31')!,
    );
    expect(depositValue(half, '2027-01-01')).toBe(10_362_500); // 1,00,000 × 1.03625
  });

  it('compounds monthly when the bank does', () => {
    expect(maturityAmount({ ...fd, compounding: 'monthly', maturity: '2028-01-15' })).toBe(
      11_498_060,
    );
  });

  it('earns simple interest when shorter than six months (bank practice)', () => {
    const short = { ...fd, maturity: '2026-04-15' }; // 90 days
    expect(maturityAmount(short)).toBe(10_172_603);
    expect(depositValue(short, '2026-03-01')).toBe(10_086_301); // 45 days in
  });

  it('stays at the principal when the interest is paid out, and says how much each time', () => {
    const payout = { ...fd, interest: 'payout' as const };
    expect(depositValue(payout, '2026-11-01')).toBe(10_000_000);
    expect(maturityAmount(payout)).toBe(10_000_000);
    expect(payoutPerPeriod(payout)).toBe(175_000);
  });

  describe('recurring deposits', () => {
    // ₹1,000 a month for a year at 7 %, compounded quarterly
    const rd: RecurringTerms = {
      instalment: 100_000,
      rateBp: 700,
      start: '2026-01-15',
      months: 12,
      compounding: 'quarterly',
    };

    it('matures a month after the last instalment, with each instalment’s interest', () => {
      expect(recurringMaturity(rd)).toBe('2027-01-15');
      // Σ 1,000 × 1.0175^(i/3), i = 1…12
      expect(recurringValue(rd, '2027-01-15')).toBe(1_246_213);
      expect(recurringValue(rd, '2027-06-01')).toBe(1_246_213);
    });

    it('counts the instalments due so far', () => {
      expect(recurringValue(rd, '2026-01-10')).toBeNull();
      expect(instalmentsDue(rd, '2026-01-10')).toBe(0);
      expect(recurringValue(rd, '2026-01-15')).toBe(100_000);
      // on the 4th instalment's day: three that grew 3, 2 and 1 months, and the new one
      expect(instalmentsDue(rd, '2026-04-15')).toBe(4);
      expect(recurringValue(rd, '2026-04-15')).toBe(403_493);
      expect(instalmentsDue(rd, '2027-03-01')).toBe(12);
    });

    it('keeps month ends in step (an RD started on the 31st)', () => {
      const end = { ...rd, start: '2026-01-31', months: 3 };
      expect(recurringMaturity(end)).toBe('2026-04-30');
      expect(instalmentsDue(end, '2026-02-28')).toBe(2);
      // 1,000 × (1.0175^(3/3) + 1.0175^(2/3) + 1.0175^(1/3))
      expect(recurringValue(end, '2026-04-30')).toBe(303_493);
    });
  });
});

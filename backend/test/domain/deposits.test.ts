import { describe, expect, it } from 'vitest';
import {
  addMonths,
  depositValue,
  instalmentsDue,
  matchScore,
  maturityAmount,
  recurringMaturity,
  recurringValue,
  payoutPerPeriod,
  type DepositTerms,
  rateOnDay,
  savingsValue,
  withKindSuffix,
  withoutKindSuffix,
  withRate,
  type RecurringTerms,
  type SavingsTerms,
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

describe('instant-access savings', () => {
  // €10,000 at 2 %, interest every day, credited on the 1st of each month
  const base: SavingsTerms = {
    opening: 1_000_000,
    start: '2026-01-01',
    rates: [{ from: '2026-01-01', rateBp: 200 }],
    compounding: 'monthly',
    movements: [],
  };

  it('is nothing before it starts, the opening amount on its first day', () => {
    expect(savingsValue(base, '2025-12-31')).toBeNull();
    expect(savingsValue(base, '2026-01-01')).toEqual({ value: 1_000_000, paidIn: 1_000_000 });
  });

  it('earns every day and credits the month’s interest on the 1st, which then earns too', () => {
    // 10 days × 1,000,000 × 2 % / 365 = 547.9
    expect(savingsValue(base, '2026-01-11')!.value).toBe(1_000_548);
    // January: 31 days = 1,698.6 → 1,699 credited on 1 Feb
    expect(savingsValue(base, '2026-02-01')).toEqual({ value: 1_001_699, paidIn: 1_000_000 });
    // February on 1,001,699: 28 × 54.89 = 1,536.9 → 1,537
    expect(savingsValue(base, '2026-03-01')!.value).toBe(1_003_236);
  });

  it('credits quarterly when so chosen, without compounding inside the quarter', () => {
    const q = { ...base, compounding: 'quarterly' as const };
    expect(savingsValue(q, '2026-02-01')!.value).toBe(1_001_699);
    // 90 days on 1,000,000 = 4,931.5 → 4,932 on 1 Apr
    expect(savingsValue(q, '2026-04-01')!.value).toBe(1_004_932);
  });

  it('follows money in and out from its day on', () => {
    const t = { ...base, movements: [{ date: '2026-01-11', amount: -500_000 }] };
    // 10 days on 1,000,000 (547.9) + 21 days on 500,000 (575.3) = 1,123
    expect(savingsValue(t, '2026-02-01')).toEqual({ value: 501_123, paidIn: 500_000 });
    // money before the start counts from its day, earning from the start
    const early = { ...base, opening: 0, movements: [{ date: '2025-12-20', amount: 1_000_000 }] };
    expect(savingsValue(early, '2025-12-25')).toBeNull();
    expect(savingsValue(early, '2026-02-01')).toEqual({ value: 1_001_699, paidIn: 1_000_000 });
    // later money is not counted yet
    const later = { ...base, movements: [{ date: '2026-03-01', amount: 1_000_000 }] };
    expect(savingsValue(later, '2026-02-01')!.paidIn).toBe(1_000_000);
  });

  it('uses each day’s rate when the rate changes', () => {
    const t = {
      ...base,
      rates: [
        { from: '2026-01-01', rateBp: 200 },
        { from: '2026-01-16', rateBp: 300 },
      ],
    };
    // 15 days at 2 % (821.9) + 16 days at 3 % (1,315.1) = 2,137
    expect(savingsValue(t, '2026-02-01')!.value).toBe(1_002_137);
    expect(rateOnDay(t.rates, '2026-01-15')).toBe(200);
    expect(rateOnDay(t.rates, '2026-02-15')).toBe(300);
  });

  it('keeps one rate per day, the new one replacing those from its day on', () => {
    const rates = [
      { from: '2026-01-01', rateBp: 200 },
      { from: '2026-03-01', rateBp: 250 },
    ];
    expect(withRate(rates, '2026-02-01', 300)).toEqual([
      { from: '2026-01-01', rateBp: 200 },
      { from: '2026-02-01', rateBp: 300 },
    ]);
    expect(withRate(rates, '2026-01-01', 150)).toEqual([{ from: '2026-01-01', rateBp: 150 }]);
    // the same rate again changes nothing
    expect(withRate(rates, '2026-04-01', 250)).toEqual(rates);
  });
});

describe('payments that may belong to a deposit', () => {
  const dep = { name: 'HDFC FD 2026', accountId: 'acc', amount: 10_000_000, start: '2026-01-15' };
  const t = (o: Partial<Parameters<typeof matchScore>[1]>) => ({
    accountId: 'other',
    amount: 1,
    date: '2025-06-01',
    text: 'REWE',
    ...o,
  });

  it('scores the same account, the same amount, words that say deposit, and the start day', () => {
    expect(matchScore(dep, t({}))).toBe(0);
    expect(matchScore(dep, t({ accountId: 'acc' }))).toBe(1);
    expect(matchScore(dep, t({ amount: 10_000_000 }))).toBe(3);
    expect(matchScore(dep, t({ text: 'Festgeldanlage' }))).toBe(2);
    expect(matchScore(dep, t({ text: 'hdfc fd 2026 opening' }))).toBe(2);
    expect(matchScore(dep, t({ date: '2026-01-12' }))).toBe(1);
    expect(
      matchScore(dep, t({ accountId: 'acc', amount: 10_000_000, date: '2026-01-15', text: 'FD' })),
    ).toBe(7);
  });

  it('does not take words inside other words for a deposit', () => {
    expect(matchScore(dep, t({ text: 'FDP Spende' }))).toBe(0);
    expect(matchScore(dep, t({ text: 'Recurring deposit instalment' }))).toBe(2);
  });
});

describe('names say the kind', () => {
  it('ends a name with FD, RD or Instant, once', () => {
    expect(withKindSuffix('HDFC', 'fd')).toBe('HDFC FD');
    expect(withKindSuffix('Post office', 'rd')).toBe('Post office RD');
    expect(withKindSuffix('Tagesgeld', 'savings')).toBe('Tagesgeld Instant');
    expect(withKindSuffix('HDFC fd', 'fd')).toBe('HDFC fd');
    expect(withKindSuffix('  SBI RD  ', 'rd')).toBe('SBI RD');
    // a word ending in the letters is not the suffix
    expect(withKindSuffix('Herd', 'rd')).toBe('Herd RD');
    // saying it anywhere is enough (an older name like "HDFC FD 2026" stays as it is)
    expect(withKindSuffix('HDFC FD 2026', 'fd')).toBe('HDFC FD 2026');
    expect(withoutKindSuffix('Trade Republic Instant', 'savings')).toBe('Trade Republic');
    expect(withoutKindSuffix('HDFC FD 2026', 'fd')).toBe('HDFC FD 2026');
    // still at most 60 characters
    expect(withKindSuffix('x'.repeat(60), 'savings')).toBe(`${'x'.repeat(52)} Instant`);
  });
});

import { describe, expect, it } from 'vitest';
import {
  fdFlows,
  rdFlows,
  savingsFlows,
  summarise,
  xirr,
  type Flow,
} from '../../src/domain/returns.js';
import {
  depositValue,
  recurringValue,
  type DepositTerms,
  type RecurringTerms,
} from '../../src/domain/deposits.js';

const fd: DepositTerms = {
  principal: 10_000_000,
  rateBp: 700,
  start: '2025-01-15',
  maturity: '2026-01-15',
  compounding: 'quarterly',
  interest: 'reinvest',
};

describe('xirr', () => {
  it('finds the yearly rate of money put in and taken out', () => {
    // 100 in, 110 back a year later: 10 %
    const r = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 110 },
    ]);
    expect(r).toBeCloseTo(0.1, 6);
  });

  it('has no answer when every flow goes one way', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('is negative for a loss', () => {
    const r = xirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2026-01-01', amount: 80 },
    ]);
    expect(r).toBeCloseTo(-0.2, 6);
  });
});

describe('deposit flows', () => {
  it('a fixed deposit: its amount in, worth today as the end', () => {
    const f = fdFlows(fd, null, '2025-07-15');
    expect(f.flows).toEqual([{ date: '2025-01-15', amount: -10_000_000 }]);
    expect(f.worth).toBe(depositValue(fd, '2025-07-15'));
  });

  it('paid out: the maturity amount comes back on the day it closed', () => {
    const f = fdFlows(fd, '2026-01-20', '2026-11-20');
    expect(f.worth).toBe(0);
    expect(f.flows).toEqual([
      { date: '2025-01-15', amount: -10_000_000 },
      { date: '2026-01-20', amount: depositValue(fd, '2026-01-15') },
    ]);
  });

  it('pays interest out each period when it is a payout deposit', () => {
    const f = fdFlows({ ...fd, interest: 'payout' }, null, '2025-08-01');
    // quarters end 15 Apr and 15 Jul; 175 000 paise each (7 % / 4 of ₹1 lakh)
    expect(f.flows).toEqual([
      { date: '2025-01-15', amount: -10_000_000 },
      { date: '2025-04-15', amount: 175_000 },
      { date: '2025-07-15', amount: 175_000 },
    ]);
    expect(f.worth).toBe(10_000_000);
  });

  it('not started yet: nothing', () => {
    expect(fdFlows(fd, null, '2025-01-01')).toEqual({ flows: [], worth: 0 });
  });

  it('a recurring deposit: each instalment due so far', () => {
    const rd: RecurringTerms = {
      instalment: 500_000,
      rateBp: 650,
      start: '2025-03-10',
      months: 12,
      compounding: 'quarterly',
    };
    const f = rdFlows(rd, null, '2025-05-20');
    expect(f.flows).toEqual([
      { date: '2025-03-10', amount: -500_000 },
      { date: '2025-04-10', amount: -500_000 },
      { date: '2025-05-10', amount: -500_000 },
    ]);
    expect(f.worth).toBe(recurringValue(rd, '2025-05-20'));
  });

  it('instant access: opening and money in and out, worth today', () => {
    const f = savingsFlows(
      {
        opening: 1_000_000,
        start: '2025-01-01',
        rates: [{ from: '2025-01-01', rateBp: 300 }],
        compounding: 'monthly',
        movements: [
          { date: '2025-02-01', amount: 200_000 },
          { date: '2025-03-01', amount: -50_000 },
        ],
      },
      null,
      '2025-06-01',
    );
    expect(f.flows).toEqual([
      { date: '2025-01-01', amount: -1_000_000 },
      { date: '2025-02-01', amount: -200_000 },
      { date: '2025-03-01', amount: 50_000 },
    ]);
    expect(f.worth).toBeGreaterThan(1_150_000);
  });

  it('instant access closed: the balance comes back on the closing day (its payout line is not counted twice)', () => {
    const f = savingsFlows(
      {
        opening: 1_000_000,
        start: '2025-01-01',
        rates: [{ from: '2025-01-01', rateBp: 0 }],
        compounding: 'monthly',
        movements: [{ date: '2025-04-01', amount: -1_000_000 }],
      },
      '2025-04-01',
      '2025-06-01',
    );
    expect(f).toEqual({
      flows: [
        { date: '2025-01-01', amount: -1_000_000 },
        { date: '2025-04-01', amount: 1_000_000 },
      ],
      worth: 0,
    });
  });
});

describe('summarise', () => {
  const flows: Flow[] = [
    { date: '2025-01-01', amount: -1_000 },
    { date: '2025-06-01', amount: 50 },
  ];

  it('adds up what went in, what came back, the gain and the yearly rate', () => {
    const s = summarise(flows, 1_050, '2026-01-01');
    expect(s).toMatchObject({
      putIn: 1_000,
      takenOut: 50,
      worth: 1_050,
      gain: 100,
      gainBp: 1_000,
      short: false,
      since: '2025-01-01',
    });
    expect(s.xirrBp).toBeGreaterThan(1_000);
  });

  it('gives no yearly rate under three months (it would say little, and wildly)', () => {
    expect(summarise(flows.slice(0, 1), 1_010, '2025-02-01').xirrBp).toBeNull();
  });

  it('a trade in and out within two weeks long ago gets no yearly rate', () => {
    const s = summarise(
      [
        { date: '2025-01-01', amount: -1_000 },
        { date: '2025-01-14', amount: 1_030 },
      ],
      0,
      '2026-01-01',
    );
    expect(s).toMatchObject({ gain: 30, short: true, xirrBp: null });
  });

  it('money going in and out again counts once for the gain %', () => {
    // 1,000 in and out each month for a year, then 1,000 kept, 30 earned
    const flows: Flow[] = [];
    for (let m = 1; m <= 12; m++) {
      const d = `2025-${String(m).padStart(2, '0')}`;
      flows.push({ date: `${d}-01`, amount: -1_000 }, { date: `${d}-15`, amount: 1_000 });
    }
    flows.push({ date: '2025-12-20', amount: -1_000 });
    const s = summarise(flows, 1_030, '2026-01-01');
    expect(s.putIn).toBe(13_000);
    expect(s.gainBp).toBe(300); // 30 on at most 1,000 in at a time
  });

  it('a negative balance counts in the yearly rate as in the gain', () => {
    const s = summarise([{ date: '2025-01-01', amount: 1_000 }], -1_050, '2026-01-01');
    expect(s.gain).toBe(-50);
    expect(s.xirrBp).not.toBeNull();
  });

  it('nothing put in: empty', () => {
    expect(summarise([], 0, '2026-01-01')).toMatchObject({
      putIn: 0,
      gain: 0,
      gainBp: null,
      xirrBp: null,
      since: null,
    });
  });
});

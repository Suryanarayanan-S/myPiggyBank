import { describe, expect, it } from 'vitest';
import { payoutCsv, payoutTotals, rangeOf, selectPayouts, type Payout } from './payouts';

const row = (p: Partial<Payout>): Payout => ({
  holdingId: 'h',
  symbol: 'INFY',
  name: 'Infosys',
  ownerMemberId: null,
  date: '2026-06-10',
  kind: 'dividend',
  units: 30,
  perShare: 25,
  amount: 75_000,
  currency: 'INR',
  ...p,
});
const rows = [
  row({}),
  row({
    symbol: 'ARE&M',
    name: 'Amara Raja',
    date: '2025-11-13',
    units: 11,
    perShare: 5.4,
    amount: 5_940,
  }),
  row({
    symbol: 'SGBFEB32IV',
    name: 'Gold bond',
    date: '2026-08-06',
    kind: 'interest',
    units: 8,
    perShare: 78.2875,
    amount: 62_630,
  }),
  row({ symbol: 'TCS', date: '2024-01-19', units: 2, perShare: 9, amount: 1_800 }),
];

describe('the payouts table', () => {
  it('picks a kind and days, searches symbol and name, and sorts', () => {
    const pick = (o: Partial<Parameters<typeof selectPayouts>[1]>) =>
      selectPayouts(rows, {
        kind: 'dividend',
        from: '2025-11-01',
        to: '2026-10-26',
        search: '',
        sort: 'date',
        desc: true,
        ...o,
      }).map((r) => r.symbol);
    expect(pick({})).toEqual(['INFY', 'ARE&M']);
    expect(pick({ kind: 'all' })).toEqual(['SGBFEB32IV', 'INFY', 'ARE&M']);
    expect(pick({ kind: 'interest' })).toEqual(['SGBFEB32IV']);
    expect(pick({ search: 'amara' })).toEqual(['ARE&M']);
    expect(pick({ from: null, to: null, sort: 'symbol', desc: false })).toEqual([
      'ARE&M',
      'INFY',
      'TCS',
    ]);
    expect(pick({ from: null, to: null, sort: 'amount', desc: true })).toEqual([
      'INFY',
      'ARE&M',
      'TCS',
    ]);
  });

  it('adds them up', () => {
    expect(payoutTotals(rows.slice(0, 2))).toEqual({
      amounts: [{ currency: 'INR', amount: 80_940 }],
      count: 2,
    });
    // each currency on its own, rupees first
    expect(
      payoutTotals([
        row({ currency: 'EUR', amount: 57 }),
        row({}),
        row({ currency: 'EUR', amount: 23 }),
      ]).amounts,
    ).toEqual([
      { currency: 'INR', amount: 75_000 },
      { currency: 'EUR', amount: 80 },
    ]);
  });

  it('writes a CSV like Console’s report', () => {
    expect(payoutCsv(rows.slice(1, 3), 'dividend')).toBe(
      [
        'Symbol,Ex-date,Qty,Dividend per share,Total dividend',
        'ARE&M,2025-11-13,11,5.4,59.40',
        'SGBFEB32IV,2026-08-06,8,78.2875,626.30',
      ].join('\n'),
    );
    expect(payoutCsv([row({ symbol: 'A,B', perShare: null })], 'all').split('\n')).toEqual([
      'Symbol,Ex-date,Qty,Per share,Total',
      '"A,B",2026-06-10,30,,750.00',
    ]);
    // with other currencies, each row says its own
    expect(
      payoutCsv([row({}), row({ currency: 'EUR', amount: 57, perShare: 0.285 })], 'dividend').split(
        '\n',
      ),
    ).toEqual([
      'Symbol,Ex-date,Qty,Dividend per share,Total dividend,Currency',
      'INFY,2026-06-10,30,25,750.00,INR',
      'INFY,2026-06-10,30,0.285,0.57,EUR',
    ]);
  });

  it('turns a period into days (the Indian financial year runs April to March)', () => {
    expect(rangeOf('fy', '2026-10-26')).toEqual({ from: '2026-04-01', to: '2026-10-26' });
    expect(rangeOf('lastFy', '2026-10-26')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(rangeOf('fy', '2026-02-10')).toEqual({ from: '2025-04-01', to: '2026-02-10' });
    expect(rangeOf('year', '2026-10-26')).toEqual({ from: '2025-10-27', to: '2026-10-26' });
    expect(rangeOf('year', '2028-02-29')).toEqual({ from: '2027-03-01', to: '2028-02-29' });
    expect(rangeOf('all', '2026-10-26')).toEqual({ from: null, to: null });
  });
});

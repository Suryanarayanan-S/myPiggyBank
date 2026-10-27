import { describe, expect, it } from 'vitest';
import {
  payoutBars,
  payoutCsv,
  payoutTotals,
  rangeOf,
  selectPayouts,
  type Payout,
} from './payouts';

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

describe('payoutBars', () => {
  const pay = (date: string, amount: number, kind: Payout['kind'] = 'dividend', currency = 'INR') =>
    row({ date, amount, kind, currency });

  it('by month for up to about a year, every month drawn', () => {
    const r = payoutBars(
      [pay('2025-11-13', 5_940), pay('2026-02-06', 62_630, 'interest'), pay('2026-02-20', 100)],
      '2025-10-28',
      '2026-03-31',
    )!;
    expect(r.step).toBe('month');
    expect(r.bars.map((b) => [b.label, b.dividend, b.interest])).toEqual([
      ['Oct ’25', 0, 0],
      ['Nov ’25', 5_940, 0],
      ['Dec ’25', 0, 0],
      ['Jan ’26', 0, 0],
      ['Feb ’26', 100, 62_630],
      ['Mar ’26', 0, 0],
    ]);
    expect(r).toMatchObject({ currency: 'INR', others: [], total: 68_670, count: 3 });
  });

  it('by quarter up to four years, by financial year beyond; no start: the first payout', () => {
    const q = payoutBars([pay('2024-05-02', 1), pay('2026-06-10', 2)], null, '2026-10-27')!;
    expect(q.step).toBe('quarter');
    expect(q.bars[0]!.label).toBe('Apr – Jun ’24');
    expect(q.bars.at(-1)!.label).toBe('Oct – Dec ’26');
    const y = payoutBars([pay('2019-03-30', 1), pay('2026-06-10', 2)], null, '2026-10-27')!;
    expect(y.step).toBe('year');
    expect(y.bars.map((b) => [b.label, b.dividend])).toEqual([
      ['FY 2018-19', 1],
      ['FY 2019-20', 0],
      ['FY 2020-21', 0],
      ['FY 2021-22', 0],
      ['FY 2022-23', 0],
      ['FY 2023-24', 0],
      ['FY 2024-25', 0],
      ['FY 2025-26', 0],
      ['FY 2026-27', 2],
    ]);
  });

  it('draws the currency with the most payouts and names the ones left out; nothing: null', () => {
    const r = payoutBars(
      [pay('2026-06-10', 2), pay('2026-06-11', 3), pay('2026-06-12', 57, 'dividend', 'EUR')],
      '2026-01-01',
      '2026-06-30',
    )!;
    expect(r).toMatchObject({ currency: 'INR', others: ['EUR'], total: 5, count: 2 });
    expect(payoutBars([], null, '2026-10-27')).toBeNull();
    // as many of each: rupees, whatever the table's order
    const tie = [pay('2026-06-10', 2, 'dividend', 'EUR'), pay('2026-06-11', 3)];
    expect(payoutBars(tie, null, '2026-10-27')!.currency).toBe('INR');
    expect(payoutBars([...tie].reverse(), null, '2026-10-27')!.currency).toBe('INR');
  });

  it('a payout outside the days asked for (dated ahead) still gets its bar', () => {
    const r = payoutBars([pay('2026-09-10', 2), pay('2026-11-05', 500)], null, '2026-10-27')!;
    expect(r.bars.map((b) => [b.label, b.dividend])).toEqual([
      ['Sep ’26', 2],
      ['Oct ’26', 0],
      ['Nov ’26', 500],
    ]);
    expect(r.bars.reduce((s, b) => s + b.dividend, 0)).toBe(r.total);
  });
});

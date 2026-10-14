import { describe, expect, it } from 'vitest';
import type { Holding } from './investments';
import {
  isSoldOut,
  listed,
  movers,
  profitSplit,
  ranked,
  sortHoldings,
  valueHistory,
} from './portfolio';

const h = (name: string, p: Partial<Holding> = {}): Holding => ({
  id: name,
  name,
  kind: 'stock',
  symbol: name,
  currency: 'INR',
  ownerMemberId: null,
  accountId: null,
  note: null,
  archived: false,
  units: '10',
  avgCost: '100',
  price: '120',
  priceDate: '2026-10-15',
  priceSource: 'price',
  cost: 100_000,
  value: 120_000,
  unrealised: 20_000,
  returnBp: 2_000,
  realised: 0,
  realisedBp: null,
  dividends: 0,
  trades: [],
  prices: [],
  inView: { value: 120_000, cost: 100_000 },
  ...p,
});

describe('portfolio', () => {
  const list = [
    h('A'),
    h('B', {
      value: 60_000,
      unrealised: -40_000,
      returnBp: -4_000,
      inView: { value: 60_000, cost: 100_000 },
    }),
    h('C', {
      value: 20_000,
      cost: 0,
      unrealised: 20_000,
      returnBp: null,
      inView: { value: 20_000, cost: 0 },
    }),
    h('Old', { archived: true }),
    h('Sold', {
      units: '0',
      value: 0,
      inView: { value: 0, cost: 0 },
      trades: [{ id: 's', date: '2026-01-02', type: 'sell', units: '10', amount: 1, fees: 0 }],
    }),
    h('NoRate', { inView: null }),
  ];

  it('weights the open holdings in one currency, largest first', () => {
    expect(ranked(list).map((r) => [r.holding.name, r.weightBp])).toEqual([
      ['A', 6_000],
      ['B', 3_000],
      ['C', 1_000],
    ]);
  });

  it('finds the biggest gainers and losers by return, leaving out free holdings', () => {
    const m = movers(list, 5);
    // A return needs no exchange rate, so NoRate ranks too.
    expect(m.gainers.map((x) => x.name)).toEqual(['A', 'NoRate']);
    expect(m.losers.map((x) => x.name)).toEqual(['B']);
  });

  it('counts holdings in profit and in loss', () => {
    // NoRate counts too: a gain needs no exchange rate.
    expect(profitSplit(list)).toEqual({ profit: 3, loss: 1, flat: 0 });
  });

  it('sorts by any column, empty values last', () => {
    const rows = ranked(list);
    expect(sortHoldings(rows, 'pnlPct', 'desc').map((r) => r.holding.name)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(sortHoldings(rows, 'name', 'desc').map((r) => r.holding.name)).toEqual(['C', 'B', 'A']);
    expect(sortHoldings(rows, 'pnl', 'asc').map((r) => r.holding.name)).toEqual(['B', 'A', 'C']);
  });

  it('values the portfolio on every day a price or trade was recorded', () => {
    const one = h('X', {
      trades: [
        { id: 't1', date: '2026-01-10', type: 'buy', units: '10', amount: 100_000, fees: 0 },
        { id: 't2', date: '2026-03-01', type: 'sell', units: '4', amount: 60_000, fees: 0 },
      ],
      prices: [{ id: 'p1', date: '2026-02-01', price: '130' }],
    });
    expect(valueHistory([one])).toEqual([
      { date: '2026-01-10', value: 100_000 }, // the buy's own price: 100
      { date: '2026-02-01', value: 130_000 },
      { date: '2026-03-01', value: 90_000 }, // 6 left at the sale's price, 150
    ]);
    // mixed currencies cannot be added up day by day
    expect(valueHistory([one, h('Y', { currency: 'EUR', trades: one.trades })])).toEqual([]);
  });

  it('lists holdings without a rate too, in their own currency and without a weight', () => {
    const rows = listed(list, 'INR');
    expect(rows.map((r) => [r.holding.name, r.currency, r.weightBp])).toEqual([
      ['A', 'INR', 6_000],
      ['B', 'INR', 3_000],
      ['C', 'INR', 1_000],
      ['NoRate', 'INR', null],
    ]);
    expect(sortHoldings(rows, 'weight', 'asc').at(-1)!.holding.name).toBe('NoRate');
  });

  it('a new holding without trades is listed (not sold), with no value yet', () => {
    const fresh = h('New', { units: '0', value: null, cost: 0, inView: null, trades: [] });
    const sold = h('Gone', {
      units: '0',
      value: 0,
      trades: [{ id: 's', date: '2026-01-02', type: 'sell', units: '1', amount: 1, fees: 0 }],
    });
    expect(isSoldOut(fresh)).toBe(false);
    expect(isSoldOut(sold)).toBe(true);
    const names = listed([h('A'), fresh, sold], 'INR').map((r) => [r.holding.name, r.empty]);
    expect(names).toEqual([
      ['A', false],
      ['New', true],
    ]);
  });

  it('money columns never compare amounts in different currencies', () => {
    const eur = h('Euro', { currency: 'EUR', value: 900_000, inView: null });
    const rows = listed([h('A'), eur], 'INR');
    expect(sortHoldings(rows, 'value', 'desc').map((r) => r.holding.name)).toEqual(['A', 'Euro']);
    expect(sortHoldings(rows, 'value', 'asc').map((r) => r.holding.name)).toEqual(['A', 'Euro']);
  });

  it('counts profit and loss for holdings without a rate too', () => {
    expect(profitSplit([h('A'), h('Euro', { inView: null, unrealised: -5 })])).toEqual({
      profit: 1,
      loss: 1,
      flat: 0,
    });
  });

  it('uses the last trade of a day, like the server (trades arrive newest first)', () => {
    const sameDay = h('X', {
      trades: [
        { id: 's', date: '2026-01-10', type: 'sell', units: '4', amount: 60_000, fees: 0 },
        { id: 'b', date: '2026-01-10', type: 'buy', units: '10', amount: 100_000, fees: 0 },
      ],
    });
    expect(valueHistory([sameDay])).toEqual([{ date: '2026-01-10', value: 90_000 }]);
  });
});

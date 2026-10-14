import { describe, expect, it } from 'vitest';
import { computeHolding, oversold, valueOf, type Trade } from '../../src/domain/holdings.js';

const U = 1_000_000; // one unit in micro-units
const t = (date: string, type: Trade['type'], units: number, amount: number, fees = 0): Trade => ({
  date,
  type,
  units: Math.round(units * U),
  amount,
  fees,
});

describe('valueOf', () => {
  it('multiplies micro-units by a micro price into minor units, rounding half up', () => {
    expect(valueOf(10 * U, 98_456_700)).toBe(98_457); // 10 × €98.4567 = €984.567 → €984.57
    expect(valueOf(1_500_000, 2_000_000)).toBe(300); // 1.5 × €2 = €3.00
  });
});

describe('computeHolding', () => {
  it('buys add units and cost (with fees); price comes from the latest price entry', () => {
    const h = computeHolding(
      [t('2026-01-10', 'buy', 10, 100_000, 500), t('2026-03-10', 'buy', 5, 60_000)],
      [
        { date: '2026-09-30', price: 130_000_000 },
        { date: '2026-06-30', price: 110_000_000 },
      ],
      '2026-10-14',
    );
    expect(h).toMatchObject({
      units: 15 * U,
      cost: 160_500,
      price: 130_000_000,
      priceDate: '2026-09-30',
      priceSource: 'price',
      value: 195_000,
      unrealised: 34_500,
      realised: 0,
      dividends: 0,
    });
    expect(h.avgCost).toBe(107_000_000); // €107.00 per unit, in micros
    expect(h.returnBp).toBe(Math.round((34_500 * 10_000) / 160_500));
  });

  it('a partial sell takes out its share of the cost and books the gain', () => {
    const h = computeHolding(
      [t('2026-01-10', 'buy', 10, 100_000), t('2026-05-10', 'sell', 4, 50_000, 300)],
      [{ date: '2026-09-30', price: 120_000_000 }],
      '2026-10-14',
    );
    expect(h).toMatchObject({ units: 6 * U, cost: 60_000, realised: 50_000 - 300 - 40_000 });
    expect(h.value).toBe(72_000);
  });

  it('selling everything leaves no units, no cost and only the realised result', () => {
    const h = computeHolding(
      [t('2026-01-10', 'buy', 3, 30_000), t('2026-02-10', 'sell', 3, 27_000)],
      [],
      '2026-10-14',
    );
    expect(h).toMatchObject({ units: 0, cost: 0, value: 0, realised: -3_000, returnBp: null });
  });

  it('dividends are added up separately', () => {
    const h = computeHolding(
      [
        t('2026-01-10', 'buy', 1, 10_000),
        t('2026-06-01', 'dividend', 0, 250),
        t('2026-09-01', 'dividend', 0, 260),
      ],
      [],
      '2026-10-14',
    );
    expect(h.dividends).toBe(510);
    expect(h.cost).toBe(10_000);
  });

  it('without a price entry uses the last trade price, and ignores future prices and trades', () => {
    const h = computeHolding(
      [
        t('2026-01-10', 'buy', 2, 20_000),
        t('2026-08-10', 'buy', 2, 30_000),
        t('2026-12-01', 'buy', 9, 1),
      ],
      [{ date: '2026-11-01', price: 999_000_000 }],
      '2026-10-14',
    );
    expect(h).toMatchObject({
      units: 4 * U,
      price: 150_000_000,
      priceSource: 'trade',
      priceDate: '2026-08-10',
      value: 60_000,
    });
  });

  it('no trades and no price: nothing to value', () => {
    expect(computeHolding([], [], '2026-10-14')).toMatchObject({
      units: 0,
      value: null,
      price: null,
    });
  });

  it('trades on the same day apply in the given order (buy before sell)', () => {
    const h = computeHolding(
      [t('2026-03-01', 'buy', 5, 50_000), t('2026-03-01', 'sell', 5, 55_000)],
      [],
      '2026-10-14',
    );
    expect(h).toMatchObject({ units: 0, realised: 5_000 });
  });
});

describe('oversold', () => {
  it('is true when a sell, in date order, needs more units than are held then', () => {
    expect(oversold([t('2026-01-01', 'buy', 2, 1), t('2026-02-01', 'sell', 2, 1)])).toBe(false);
    expect(oversold([t('2026-02-01', 'sell', 1, 1), t('2026-03-01', 'buy', 5, 1)])).toBe(true);
    expect(oversold([t('2026-01-01', 'buy', 1, 1), t('2026-02-01', 'sell', 1.000001, 1)])).toBe(
      true,
    );
  });
});

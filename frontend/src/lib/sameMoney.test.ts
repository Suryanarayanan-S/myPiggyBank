import { describe, expect, it } from 'vitest';
import { cashFlows, sameMoney, sameMoneyComparison } from './sameMoney';
import type { Holding } from './investments';

const holding = (p: Partial<Holding>) =>
  ({
    id: 'h',
    archived: false,
    currency: 'INR',
    trades: [],
    prices: [],
    value: 0,
    ...p,
  }) as unknown as Holding;
const trade = (date: string, type: string, units: string | null, amount: number, fees = 0) => ({
  id: `${date}${type}`,
  date,
  type,
  units,
  amount,
  fees,
});

describe('the same money elsewhere', () => {
  it('turns buys and sales into money in and out (dividends are left out)', () => {
    const h = holding({
      // newest first, as the API sends them
      trades: [
        trade('2024-03-01', 'dividend', null, 500),
        trade('2024-02-01', 'sell', '5', 60_000, 100),
        trade('2024-01-01', 'buy', '10', 100_000, 200),
      ],
    } as Partial<Holding>);
    expect(
      cashFlows([
        h,
        holding({
          archived: true,
          trades: [trade('2023-01-01', 'buy', '1', 9)],
        } as Partial<Holding>),
      ]),
    ).toEqual([
      { date: '2024-01-01', amount: 100_200 },
      { date: '2024-02-01', amount: -59_900 },
    ]);
  });

  it('buys and sells the market on the same days for the same money', () => {
    // ₹1,000 in at 100, ₹600 out at 120 (5 units), then the market reaches 150
    const series = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-02-01', value: 120 },
      { date: '2024-03-01', value: 150 },
    ];
    const flows = [
      { date: '2024-01-01', amount: 100_000 },
      { date: '2024-02-01', amount: -60_000 },
    ];
    expect(
      sameMoney(flows, series, ['2024-01-01', '2024-02-01', '2024-03-01', '2024-03-05']),
    ).toEqual([
      { date: '2024-01-01', value: 100_000 },
      { date: '2024-02-01', value: 60_000 },
      { date: '2024-03-01', value: 75_000 },
      // no newer price: the last one
      { date: '2024-03-05', value: 75_000 },
    ]);
  });

  it('never sells more than it holds: what yours took out beyond it is owed, not shorted', () => {
    // ₹1,000 in at 100 (10 units); yours did better and ₹1,500 comes out at 120 (worth ₹1,200)
    const r = sameMoney(
      [
        { date: '2024-01-01', amount: 100_000 },
        { date: '2024-02-01', amount: -150_000 },
      ],
      [
        { date: '2024-01-01', value: 100 },
        { date: '2024-02-01', value: 120 },
        { date: '2024-03-01', value: 60 },
      ],
      ['2024-02-01', '2024-03-01'],
    );
    // −₹300 either way: the market falling later changes nothing
    expect(r).toEqual([
      { date: '2024-02-01', value: -30_000 },
      { date: '2024-03-01', value: -30_000 },
    ]);
  });

  it('counts a sale of more than was bought only for the units held', () => {
    const h = holding({
      trades: [trade('2024-02-01', 'sell', '10', 200_000), trade('2024-01-01', 'buy', '5', 50_000)],
    } as Partial<Holding>);
    expect(cashFlows([h])).toEqual([
      { date: '2024-01-01', amount: 50_000 },
      { date: '2024-02-01', amount: -100_000 },
    ]);
  });

  it('uses the first price after a buy made before the market line starts', () => {
    const r = sameMoney(
      [{ date: '2023-12-29', amount: 100_000 }],
      [{ date: '2024-01-01', value: 50 }],
      ['2024-01-01'],
    );
    expect(r).toEqual([{ date: '2024-01-01', value: 100_000 }]);
  });

  it('compares the gain of yours with each market’s, and their yearly rates', () => {
    // 10 bought at ₹100 on 1 Jan 2023, worth ₹150 each a year later; Nifty went 100 → 110
    const h = holding({
      trades: [trade('2023-01-02', 'buy', '10', 100_000)],
      prices: [{ date: '2024-01-02', price: '150' }],
      value: 150_000,
    } as Partial<Holding>);
    const c = sameMoneyComparison([h], {
      nifty50: [
        { date: '2023-01-02', value: 100 },
        { date: '2024-01-02', value: 110 },
      ],
    });
    expect(c.invested).toBe(100_000);
    expect(c.rows.at(-1)).toEqual({
      date: '2024-01-02',
      invested: 100_000,
      gain: { portfolio: 50_000, nifty50: 10_000 },
    });
    expect(c.summary.portfolio).toMatchObject({ value: 150_000, gain: 50_000 });
    expect(c.summary.portfolio!.xirr).toBeCloseTo(0.5, 2);
    expect(c.summary.nifty50).toMatchObject({ value: 110_000, gain: 10_000 });
    expect(c.summary.nifty50!.xirr).toBeCloseTo(0.1, 2);
  });
});

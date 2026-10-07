import { describe, expect, it } from 'vitest';
import { computeNetWorth } from '../../src/domain/networth.js';
import type { Rate } from '../../src/domain/currency.js';

const L = (lakh: number) => Math.round(lakh * 100_000 * 100); // lakh rupees → paise
const members = [
  { id: 'appa', name: 'Appa' },
  { id: 'surya', name: 'Surya' },
  { id: 'adhira', name: 'Adhira' },
  { id: 'dayana', name: 'Dayana' },
];
const rates: Rate[] = [{ month: '2026-09', base: 'EUR', quote: 'INR', rateMicros: 100_000_000 }];
const acc = (
  p: Partial<{
    name: string;
    balance: number;
    currency: string;
    assetClass: string;
    ownerMemberId: string | null;
    archived: boolean;
  }>,
) => ({
  name: 'Acc',
  balance: 0,
  currency: 'EUR',
  assetClass: 'liquid',
  ownerMemberId: null,
  archived: false,
  ...p,
});
const asset = (
  name: string,
  lakh: number | null,
  assetClass: string,
  ownerMemberId: string | null,
  currency = 'INR',
) => ({
  name,
  value: lakh === null ? null : L(lakh),
  currency,
  assetClass,
  ownerMemberId,
});

const input = {
  currency: 'INR',
  month: '2026-10',
  rates,
  members,
  accounts: [
    acc({ name: 'Sparkasse', balance: 250_000, ownerMemberId: 'surya' }), // €2,500 → ₹2.5 L
    acc({ name: 'Spreadsheet history', balance: 9_999_999, archived: true }),
    acc({ name: 'Credit card', balance: -10_000 }), // −€100 → −₹10,000, shared
  ],
  assets: [
    asset('Jothi ilam', 80, 'property', 'appa'),
    asset('Aniyapuram land', 20, 'property', 'surya'),
    asset('TMB FD', 5, 'liquid', 'adhira'),
    asset('Paytm stocks', 4.5, 'investment', 'appa'),
    asset('Kotak FD', 7.5, 'liquid', 'dayana'),
    asset('Zerodha', 12, 'investment', 'surya'),
    asset('Not valued yet', null, 'other', 'surya'),
  ],
  liabilities: [
    { name: 'Car loan', outstanding: 500_000, currency: 'EUR', ownerMemberId: 'surya' },
  ], // €5,000 → ₹5 L
};

describe('computeNetWorth', () => {
  const nw = computeNetWorth(input);

  it('totals assets, liabilities and net worth in the wealth currency', () => {
    expect(nw).toMatchObject({
      currency: 'INR',
      assets: L(131.4),
      liabilities: L(5),
      netWorth: L(126.4),
      debtRatioBp: 381,
      unconverted: [],
    });
    expect(nw.byClass).toEqual({
      liquid: L(14.9),
      property: L(100),
      investment: L(16.5),
      other: 0,
    });
  });

  it('builds one column per member like the Financial Report, Shared last, skipping empty ones', () => {
    expect(
      nw.columns.map((c) => [
        c.name,
        c.liquid,
        c.property,
        c.investment,
        c.liabilities,
        c.netWorth,
      ]),
    ).toEqual([
      ['Appa', 0, L(80), L(4.5), 0, L(84.5)],
      ['Surya', L(2.5), L(20), L(12), L(5), L(29.5)],
      ['Adhira', L(5), 0, 0, 0, L(5)],
      ['Dayana', L(7.5), 0, 0, 0, L(7.5)],
      ['Shared', -1_000_000, 0, 0, 0, -1_000_000],
    ]);
  });

  it('never adds other currencies 1:1: without a rate they are reported and left out', () => {
    const x = computeNetWorth({
      ...input,
      accounts: [acc({ name: 'Monzo', balance: 50_000, currency: 'GBP' })],
      assets: [],
      liabilities: [],
    });
    expect(x.assets).toBe(0);
    expect(x.unconverted).toEqual([{ currency: 'GBP', amount: 50_000 }]);
  });

  it('handles an empty family', () => {
    const x = computeNetWorth({ ...input, accounts: [], assets: [], liabilities: [] });
    expect(x).toMatchObject({
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      debtRatioBp: null,
      columns: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { kindOf, readBrokerHoldings } from '../../src/domain/brokerHoldings.js';

const HEAD = [
  'Instrument',
  'Qty.',
  'Avg. cost',
  'LTP',
  'Invested',
  'Cur. val',
  'P&L',
  'Net chg.',
  'Day chg.',
  '',
];

describe('readBrokerHoldings (Zerodha Kite export)', () => {
  it('reads units, invested money and the last price', () => {
    const r = readBrokerHoldings([
      HEAD,
      ['GOLDBEES', '5030', '62.21', '119.72', '312899.59', '602191.6', '', '', '', ''],
      ['ARE&M', '15', '721.08', '740.4', '10816.13', '11106', '', '', '', ''],
      // a rights entitlement received for free
      ['NATCO-RE', '5', '0', '27.25', '0', '136.25', '', '', '', ''],
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { symbol: 'GOLDBEES', units: 5_030_000_000, invested: 31_289_959, price: 119_720_000 },
      { symbol: 'ARE&M', units: 15_000_000, invested: 1_081_613, price: 740_400_000 },
      { symbol: 'NATCO-RE', units: 5_000_000, invested: 0, price: 27_250_000 },
    ]);
  });

  it('says which rows it could not read, and refuses other files', () => {
    const r = readBrokerHoldings([
      HEAD,
      ['INFY', 'abc', '1', '2', '3', '', '', '', '', ''],
      ['TCS', '8', '2966.53', '', '23732.2', '', '', '', '', ''],
    ]);
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([
      { line: 2, symbol: 'INFY', message: 'Quantity is not a number above zero' },
      { line: 3, symbol: 'TCS', message: 'Last price is missing' },
    ]);
    expect(() =>
      readBrokerHoldings([
        ['Date', 'Amount'],
        ['1', '2'],
      ]),
    ).toThrow(/Zerodha/);
  });

  it('a symbol listed twice is one holding', () => {
    const r = readBrokerHoldings([
      HEAD,
      ['INFY', '2', '100', '150', '200', '', '', '', '', ''],
      ['INFY', '3', '110', '150', '330', '', '', '', '', ''],
    ]);
    expect(r.rows).toEqual([
      { symbol: 'INFY', units: 5_000_000, invested: 53_000, price: 150_000_000 },
    ]);
  });
});

describe('kindOf', () => {
  it.each([
    ['SGBAUG28V', 'gold'],
    ['SGBFEB32IV-GB', 'gold'],
    ['GOLDBEES', 'gold'],
    ['SETFGOLD', 'gold'],
    ['NIFTYBEES', 'etf'],
    ['GOLDIAM', 'stock'],
    ['INDIGRID', 'other'],
    ['EMBASSY', 'other'],
    ['PGINVIT-IV', 'other'],
    ['INFY', 'stock'],
  ])('%s is %s', (symbol, kind) => expect(kindOf(symbol)).toBe(kind));
});

describe('amounts', () => {
  it('reads invested money exactly, with a dot or a comma', () => {
    const r = readBrokerHoldings([
      HEAD,
      ['A', '1', '0', '1', '0.285', '', '', '', '', ''],
      ['B', '1', '0', '1', '1,005', '', '', '', '', ''],
    ]);
    expect(r.rows.map((x) => x.invested)).toEqual([29, 101]);
  });
});

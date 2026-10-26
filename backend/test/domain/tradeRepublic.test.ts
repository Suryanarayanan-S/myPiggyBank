import { describe, expect, it } from 'vitest';
import { readTradeRepublic } from '../../src/domain/tradeRepublic.js';

const HEAD =
  'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
// the export's columns, values made up
const row = (o: Record<string, string>) =>
  HEAD.split(',')
    .map((k) => o[k] ?? '')
    .join(',');
const rows = (...lines: string[]) => [HEAD, ...lines].map((l) => l.split(','));

describe('readTradeRepublic (Trade Republic transactions export)', () => {
  it('reads buys, sells and dividends; leaves out cash movements', () => {
    const r = readTradeRepublic(
      rows(
        row({
          date: '2025-09-11',
          category: 'CASH',
          type: 'TRANSFER_INBOUND',
          amount: '50.000000',
          currency: 'EUR',
          transaction_id: 't0',
        }),
        row({
          date: '2025-09-11',
          category: 'TRADING',
          type: 'BUY',
          asset_class: 'STOCK',
          name: 'Toyota Motor',
          symbol: 'JP3633400001',
          shares: '2.0000000000',
          price: '16.7960000000',
          amount: '-33.59',
          fee: '-1.00',
          currency: 'EUR',
          transaction_id: 't1',
        }),
        row({
          date: '2025-09-11',
          category: 'TRADING',
          type: 'BUY',
          asset_class: 'STOCK',
          name: 'Toyota Motor',
          symbol: 'JP3633400001',
          shares: '0.6788900000',
          price: '16.7960000000',
          amount: '-11.40',
          currency: 'EUR',
          transaction_id: 't2',
        }),
        row({
          date: '2025-11-26',
          category: 'CASH',
          type: 'DIVIDEND',
          asset_class: 'STOCK',
          name: 'Toyota Motor',
          symbol: 'JP3633400001',
          shares: '2.6788900000',
          amount: '0.570000',
          tax: '-0.07',
          currency: 'EUR',
          transaction_id: 't3',
        }),
        row({
          date: '2026-02-02',
          category: 'TRADING',
          type: 'SELL',
          asset_class: 'ETF',
          name: 'World ETF',
          symbol: 'IE00B4L5Y983',
          shares: '1.5',
          price: '100',
          amount: '150.00',
          fee: '-1.00',
          tax: '-3.10',
          currency: 'EUR',
          transaction_id: 't4',
        }),
        row({
          date: '2026-02-03',
          category: 'CASH',
          type: 'INTEREST_PAYMENT',
          amount: '0.42',
          currency: 'EUR',
          transaction_id: 't5',
        }),
      ),
    );
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual({ TRANSFER_INBOUND: 1, INTEREST_PAYMENT: 1 });
    expect(r.rows).toEqual([
      {
        line: 3,
        ref: 't1',
        date: '2025-09-11',
        isin: 'JP3633400001',
        name: 'Toyota Motor',
        kind: 'stock',
        type: 'buy',
        units: 2_000_000,
        amount: 3_359,
        fees: 100,
        currency: 'EUR',
      },
      {
        line: 4,
        ref: 't2',
        date: '2025-09-11',
        isin: 'JP3633400001',
        name: 'Toyota Motor',
        kind: 'stock',
        type: 'buy',
        units: 678_890,
        amount: 1_140,
        fees: 0,
        currency: 'EUR',
      },
      // gross; the tax withheld kept beside it
      {
        line: 5,
        ref: 't3',
        date: '2025-11-26',
        isin: 'JP3633400001',
        name: 'Toyota Motor',
        kind: 'stock',
        type: 'dividend',
        units: 0,
        amount: 57,
        fees: 7,
        currency: 'EUR',
      },
      // a sale's tax is on the gain: not a cost of the sale
      {
        line: 6,
        ref: 't4',
        date: '2026-02-02',
        isin: 'IE00B4L5Y983',
        name: 'World ETF',
        kind: 'etf',
        type: 'sell',
        units: 1_500_000,
        amount: 15_000,
        fees: 100,
        currency: 'EUR',
      },
    ]);
  });

  it('reads a reversed dividend as money back, and a row given twice once', () => {
    const div = (ref: string, amount: string) =>
      row({
        date: '2026-01-02',
        category: 'CASH',
        type: 'DIVIDEND',
        symbol: 'JP3633400001',
        amount,
        currency: 'EUR',
        transaction_id: ref,
      });
    const r = readTradeRepublic(rows(div('d1', '0.57'), div('d2', '-0.57'), div('d1', '0.57')));
    expect(r.rows.map((x) => [x.ref, x.amount])).toEqual([
      ['d1', 57],
      ['d2', -57],
    ]);
  });

  it('says what it cannot read, and refuses another file', () => {
    const r = readTradeRepublic(
      rows(
        row({
          date: '2025-13-01',
          category: 'TRADING',
          type: 'BUY',
          symbol: 'JP3633400001',
          shares: '1',
          amount: '-1',
          currency: 'EUR',
          transaction_id: 'a',
        }),
        row({
          date: '2025-01-01',
          category: 'TRADING',
          type: 'BUY',
          symbol: 'JP3633400001',
          shares: 'x',
          amount: '-1',
          currency: 'EUR',
          transaction_id: 'b',
        }),
        row({
          date: '2025-01-01',
          category: 'TRADING',
          type: 'BUY',
          symbol: 'JP3633400001',
          shares: '1',
          amount: '-1',
          currency: 'EUR',
        }),
      ),
    );
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(() => readTradeRepublic([['symbol', 'trade_date']])).toThrow(/Trade Republic/);
  });
});

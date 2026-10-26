import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const HEAD =
  'datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code';
const row = (o: Record<string, string>) =>
  HEAD.split(',')
    .map((k) => o[k] ?? '')
    .join(',');
const file = (...lines: string[]) => Buffer.from([HEAD, ...lines].join('\n')).toString('base64');
const buy = (ref: string, date: string, shares: string, amount: string, fee = '') =>
  row({
    date,
    category: 'TRADING',
    type: 'BUY',
    asset_class: 'STOCK',
    name: 'Toyota Motor',
    symbol: 'JP3633400001',
    shares,
    amount: `-${amount}`,
    fee: fee && `-${fee}`,
    currency: 'EUR',
    transaction_id: ref,
  });
const dividend = (ref: string, date: string, amount: string, tax: string) =>
  row({
    date,
    category: 'CASH',
    type: 'DIVIDEND',
    asset_class: 'STOCK',
    name: 'Toyota Motor',
    symbol: 'JP3633400001',
    shares: '2',
    amount,
    tax: `-${tax}`,
    currency: 'EUR',
    transaction_id: ref,
  });

describe('Trade Republic import', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let surya: string;
  let tr: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app, { name: 'Surya' })).cookie);
    surya = (await call('GET', '/api/members')).json().data[0].id;
    tr = (
      await call('POST', '/api/accounts', {
        name: 'Trade Republic',
        type: 'investment',
        currency: 'EUR',
        ownerMemberId: surya,
      })
    ).json().data.id;
  });
  afterEach(() => app.close());

  const send = (kind: 'preview' | 'commit', data: string, accountId = tr) =>
    call('POST', `/api/holdings/trade-republic/${kind}`, { fileName: 'tx.csv', data, accountId });
  const first = file(
    row({
      date: '2025-09-11',
      category: 'CASH',
      type: 'TRANSFER_INBOUND',
      amount: '50',
      currency: 'EUR',
      transaction_id: 'c1',
    }),
    buy('t1', '2025-09-11', '2', '33.59', '1.00'),
    dividend('t2', '2025-11-26', '0.57', '0.07'),
  );

  it('previews and imports the holdings into the account, each row once', async () => {
    const p = (await send('preview', first)).json().data;
    expect(p).toMatchObject({
      currency: 'EUR',
      skipped: { TRANSFER_INBOUND: 1 },
      errors: [],
      holdings: [
        {
          isin: 'JP3633400001',
          name: 'Toyota Motor',
          status: 'new',
          trades: 1,
          dividends: 1,
          known: 0,
          units: '2',
        },
      ],
    });
    expect((await send('commit', first)).json().data).toEqual({ created: 1, added: 2, known: 0 });
    const [h] = (await call('GET', '/api/holdings')).json().data.holdings;
    expect(h).toMatchObject({
      name: 'Toyota Motor',
      symbol: 'JP3633400001',
      kind: 'stock',
      currency: 'EUR',
      ownerMemberId: surya,
      accountId: tr,
      units: '2',
      cost: 3_459,
      dividends: 57,
    });
    // a later export overlapping this one: only what is new
    const later = file(
      buy('t1', '2025-09-11', '2', '33.59', '1.00'),
      dividend('t2', '2025-11-26', '0.57', '0.07'),
      buy('t3', '2026-01-20', '1', '20.00'),
    );
    expect((await send('preview', later)).json().data.holdings[0]).toMatchObject({
      status: 'held',
      trades: 1,
      known: 2,
      units: '3',
    });
    expect((await send('commit', later)).json().data).toEqual({ created: 0, added: 1, known: 2 });
    const trades = await prisma.holdingTrade.findMany({ where: { holdingId: h.id } });
    expect(trades).toHaveLength(3);
    // the dividend's tax is kept beside it
    expect(trades.find((t) => t.type === 'dividend')).toMatchObject({ amount: 57n, fees: 7n });
    // and listed with the Indian payouts, in its currency
    const payouts = (await call('GET', '/api/holdings/payouts')).json().data;
    expect(payouts).toEqual([
      expect.objectContaining({
        symbol: 'JP3633400001',
        name: 'Toyota Motor',
        date: '2025-11-26',
        units: 2,
        perShare: 0.285,
        amount: 57,
        currency: 'EUR',
      }),
    ]);
  });

  it('comes in scaled to the new units when a split was applied since', async () => {
    await send('commit', first);
    const [h] = (await call('GET', '/api/holdings')).json().data.holdings;
    await prisma.holdingAction.create({
      data: {
        holdingId: h.id,
        exDate: new Date('2026-01-01T00:00:00Z'),
        purpose: 'Split 1:5',
        kind: 'split',
        status: 'applied',
        num: 5,
        den: 1,
        unitsBefore: 2_000_000n,
        unitsAfter: 10_000_000n,
      },
    });
    await prisma.holdingTrade.updateMany({
      where: { holdingId: h.id, type: 'buy' },
      data: { units: 10_000_000n },
    });
    // an older buy seen only now: in the old units in the file
    await send('commit', file(buy('t0', '2025-08-01', '1', '15.00')));
    const units = (await call('GET', '/api/holdings')).json().data.holdings[0].units;
    expect(units).toBe('15');
  });

  it('refuses an account that is not an investment account in the file’s currency', async () => {
    const inr = (
      await call('POST', '/api/accounts', { name: 'Zerodha', type: 'investment', currency: 'INR' })
    ).json().data.id;
    const bank = (
      await call('POST', '/api/accounts', { name: 'N26', type: 'current', currency: 'EUR' })
    ).json().data.id;
    expect((await send('preview', first, inr)).statusCode).toBe(400);
    expect((await send('preview', first, bank)).statusCode).toBe(400);
    expect(
      (await send('preview', Buffer.from('symbol,trade_date\nX,2024-01-01').toString('base64')))
        .statusCode,
    ).toBe(400);
  });

  it('takes a sale of what ten-place fractions add up to as all of it, not more', async () => {
    const third = (ref: string, date: string) => buy(ref, date, '0.3333333333', '10.00');
    const sell = row({
      date: '2025-12-01',
      category: 'TRADING',
      type: 'SELL',
      asset_class: 'STOCK',
      name: 'Toyota Motor',
      symbol: 'JP3633400001',
      shares: '1.0000000000',
      amount: '35.00',
      currency: 'EUR',
      transaction_id: 's1',
    });
    const data = file(
      third('a', '2025-09-01'),
      third('b', '2025-10-01'),
      third('c', '2025-11-03'),
      sell,
    );
    expect((await send('preview', data)).json().data.holdings[0].status).toBe('new');
    expect((await send('commit', data)).json().data).toMatchObject({ added: 4 });
  });

  it('leaves out a security that sells more than the account holds', async () => {
    const sell = row({
      date: '2025-10-01',
      category: 'TRADING',
      type: 'SELL',
      asset_class: 'STOCK',
      name: 'Toyota Motor',
      symbol: 'JP3633400001',
      shares: '5',
      amount: '100',
      currency: 'EUR',
      transaction_id: 's1',
    });
    const p = (await send('preview', file(buy('t1', '2025-09-11', '2', '33.59'), sell))).json()
      .data;
    expect(p.holdings[0]).toMatchObject({ status: 'oversold' });
    expect(
      (await send('commit', file(buy('t1', '2025-09-11', '2', '33.59'), sell))).json().data,
    ).toEqual({ created: 0, added: 0, known: 0 });
  });
});

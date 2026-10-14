import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { client, makeApp, resetDb, signUp } from './helpers.js';

const today = todayLocal();
const thisMonth = today.slice(0, 7);

async function family(app: FastifyInstance) {
  const call = client(app, (await signUp(app, { name: 'Surya' })).cookie);
  const me = (await call('GET', '/api/members')).json().data[0];
  // Wealth is shown in INR by default; EUR → INR = 100 this month.
  await call('PUT', '/api/exchange-rates', {
    month: thisMonth,
    base: 'EUR',
    quote: 'INR',
    rate: '100',
  });
  const etf = (
    await call('POST', '/api/holdings', {
      name: 'MSCI World ETF',
      kind: 'etf',
      symbol: 'IE00B4L5Y983',
      currency: 'EUR',
      ownerMemberId: me.id,
    })
  ).json().data;
  return { call, me, etf };
}

describe('investments', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
  });
  afterEach(() => app.close());

  const trade = (body: object, id = f.etf.id) => f.call('POST', `/api/holdings/${id}/trades`, body);
  const list = async (q = '') => (await f.call('GET', `/api/holdings${q}`)).json().data;

  it('buys, a price and a dividend give units, value, gain and a summary in the wealth currency', async () => {
    expect(
      (
        await trade({
          date: addDays(today, -60),
          type: 'buy',
          units: '10',
          amount: 100_000,
          fees: 500,
        })
      ).statusCode,
    ).toBe(200);
    await trade({ date: addDays(today, -5), type: 'dividend', amount: 1_200 });
    await f.call('POST', `/api/holdings/${f.etf.id}/prices`, { date: today, price: '120.50' });

    const { holdings, summary } = await list();
    expect(holdings[0]).toMatchObject({
      name: 'MSCI World ETF',
      units: '10',
      cost: 100_500,
      price: '120.5',
      priceSource: 'price',
      value: 120_500,
      unrealised: 20_000,
      dividends: 1_200,
    });
    expect(holdings[0].trades).toHaveLength(2);
    expect(summary).toMatchObject({
      currency: 'INR',
      value: 12_050_000,
      invested: 10_050_000,
      unrealised: 2_000_000,
      dividends: 120_000,
      unconverted: [],
    });
    expect(summary.byKind).toEqual([{ kind: 'etf', value: 12_050_000 }]);
    expect(summary.byMember).toEqual([{ memberId: f.me.id, name: 'Surya', value: 12_050_000 }]);
    expect((await list('?currency=EUR')).summary.value).toBe(120_500);
    // Each holding also in the summary currency, so weights compare like with like.
    expect(holdings[0].inView).toEqual({ value: 12_050_000, cost: 10_050_000 });
    expect((await list('?currency=EUR')).holdings[0].inView).toEqual({
      value: 120_500,
      cost: 100_500,
    });
    expect((await list('?currency=USD')).holdings[0].inView).toBeNull(); // no EUR→USD rate
  });

  it('refuses to sell more than is held, also by deleting an earlier buy', async () => {
    await trade({ date: addDays(today, -30), type: 'buy', units: '2', amount: 20_000 });
    const res = await trade({
      date: addDays(today, -10),
      type: 'sell',
      units: '3',
      amount: 33_000,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_ENOUGH_UNITS');

    await trade({ date: addDays(today, -10), type: 'sell', units: '1', amount: 11_000 });
    const buyId = (await list()).holdings[0].trades.find(
      (t: { type: string }) => t.type === 'buy',
    ).id;
    expect((await f.call('DELETE', `/api/holdings/${f.etf.id}/trades/${buyId}`)).statusCode).toBe(
      409,
    );
  });

  it('a price for the same day replaces the earlier one', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '1', amount: 10_000 });
    await f.call('POST', `/api/holdings/${f.etf.id}/prices`, { date: today, price: '100' });
    await f.call('POST', `/api/holdings/${f.etf.id}/prices`, { date: today, price: '101' });
    const h = (await list()).holdings[0];
    expect(h.prices).toHaveLength(1);
    expect(h.value).toBe(10_100);
  });

  it('net worth counts holdings at their current value or, if chosen, at what was invested', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '1', amount: 10_000 });
    await f.call('POST', `/api/holdings/${f.etf.id}/prices`, { date: today, price: '150' });
    const investments = async () =>
      (await f.call('GET', '/api/net-worth')).json().data.current.byClass.investment;
    expect((await f.call('GET', '/api/family')).json().data.investmentsAt).toBe('value');
    expect(await investments()).toBe(1_500_000);
    const res = await f.call('PUT', '/api/family', { investmentsAt: 'invested' });
    expect(res.json().data.investmentsAt).toBe('invested');
    expect(await investments()).toBe(1_000_000);
    expect((await f.call('PUT', '/api/family', { investmentsAt: 'guess' })).statusCode).toBe(400);
  });

  it('counts in net worth as an investment of its owner; archived holdings do not', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '1', amount: 10_000 });
    let nw = (await f.call('GET', '/api/net-worth')).json().data.current;
    expect(nw.byClass.investment).toBe(1_000_000);
    expect(nw.columns.find((c: { name: string }) => c.name === 'Surya').investment).toBe(1_000_000);

    await f.call('PUT', `/api/holdings/${f.etf.id}`, { archived: true });
    nw = (await f.call('GET', '/api/net-worth')).json().data.current;
    expect(nw.byClass.investment).toBe(0);
    expect((await list()).summary.value).toBe(0);
  });

  it('a goal can count a holding', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '2', amount: 20_000 });
    await f.call('POST', '/api/goals', {
      name: 'School fees',
      targetAmount: 100_000,
      currency: 'EUR',
      links: [{ kind: 'holding', id: f.etf.id }],
    });
    const goal = (await f.call('GET', '/api/goals')).json().data[0];
    expect(goal).toMatchObject({
      saved: 20_000,
      links: [{ kind: 'holding', name: 'MSCI World ETF' }],
    });
  });

  it('locks the currency once there are trades', async () => {
    expect((await f.call('PUT', `/api/holdings/${f.etf.id}`, { currency: 'USD' })).statusCode).toBe(
      200,
    );
    await trade({ date: today, type: 'buy', units: '1', amount: 100 });
    expect((await f.call('PUT', `/api/holdings/${f.etf.id}`, { currency: 'EUR' })).statusCode).toBe(
      409,
    );
  });

  it.each([
    [{ type: 'buy', units: '0', amount: 100 }],
    [{ type: 'buy', units: 'ten', amount: 100 }],
    [{ type: 'buy', amount: 100 }],
    [{ type: 'buy', units: '1', amount: 0 }],
    [{ type: 'buy', units: '1', amount: 100, fees: -1 }],
    [{ type: 'swap', units: '1', amount: 100 }],
  ])('rejects invalid trades %#', async (body) => {
    expect((await trade({ date: today, ...body })).statusCode).toBe(400);
  });

  it('refuses trades in the future', async () => {
    expect(
      (await trade({ date: addDays(today, 3), type: 'buy', units: '1', amount: 100 })).statusCode,
    ).toBe(400);
  });

  it('keeps holdings inside the family', async () => {
    const other = await family(app);
    expect((await other.call('GET', `/api/holdings`)).json().data.holdings).toHaveLength(1);
    expect((await other.call('PUT', `/api/holdings/${f.etf.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect((await other.call('DELETE', `/api/holdings/${f.etf.id}`)).statusCode).toBe(404);
    expect(
      (
        await other.call('POST', `/api/holdings/${f.etf.id}/trades`, {
          date: today,
          type: 'buy',
          units: '1',
          amount: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await f.call('POST', '/api/holdings', {
          name: 'Theirs',
          kind: 'stock',
          currency: 'EUR',
          ownerMemberId: other.me.id,
        })
      ).statusCode,
    ).toBe(404);
    expect((await f.call('DELETE', `/api/holdings/${f.etf.id}`)).statusCode).toBe(200);
    expect((await list()).holdings).toEqual([]);
  });

  it('archiving a holding keeps it in goals (like an archived account)', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '5', amount: 50_000 });
    await f.call('POST', '/api/goals', {
      name: 'Car',
      targetAmount: 100_000,
      currency: 'EUR',
      links: [{ kind: 'holding', id: f.etf.id }],
    });
    await f.call('PUT', `/api/holdings/${f.etf.id}`, { archived: true });
    const goal = (await f.call('GET', '/api/goals')).json().data[0];
    expect(goal).toMatchObject({ saved: 50_000, links: [{ kind: 'holding', id: f.etf.id }] });
  });

  it('a sold-out holding without a rate neither blocks snapshots nor hides its result', async () => {
    const usd = (
      await f.call('POST', '/api/holdings', { name: 'Apple', kind: 'stock', currency: 'USD' })
    ).json().data;
    await trade({ date: addDays(today, -20), type: 'buy', units: '2', amount: 30_000 }, usd.id);
    await trade({ date: addDays(today, -10), type: 'sell', units: '2', amount: 30_200 }, usd.id);
    const nw = (await f.call('GET', '/api/net-worth')).json().data.current;
    expect(nw.unconverted).toEqual([]);
    expect((await f.call('POST', '/api/net-worth/snapshots', {})).statusCode).toBe(201);
    const { summary } = await list();
    expect(summary.unconverted).toEqual([{ currency: 'USD', amount: 200 }]); // the realised gain
  });

  it('summary gain is value minus invested, never off by a rounding cent', async () => {
    await trade({ date: addDays(today, -3), type: 'buy', units: '3', amount: 10_001 });
    await f.call('POST', `/api/holdings/${f.etf.id}/prices`, { date: today, price: '33.335' });
    const { summary } = await list();
    expect(summary.unrealised).toBe(summary.value - summary.invested);
  });

  it('dividends take no fees and ignore units', async () => {
    expect((await trade({ date: today, type: 'dividend', amount: 100, fees: 5 })).statusCode).toBe(
      400,
    );
    expect(
      (await trade({ date: today, type: 'dividend', amount: 100, units: 'n/a' })).statusCode,
    ).toBe(200);
  });
});

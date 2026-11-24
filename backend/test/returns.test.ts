import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { addMonths } from '../src/domain/deposits.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('returns of every kind of investment', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  const today = todayLocal();
  const ago = (days: number) => addDays(today, -days);
  const returns = async (q = '') => (await call('GET', `/api/investments/returns${q}`)).json().data;

  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    await call('PUT', '/api/family', { wealthCurrency: 'INR' });
    // EUR → INR = 100 this month
    await call('PUT', '/api/exchange-rates', {
      month: today.slice(0, 7),
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
  });
  afterEach(() => app.close());

  it('is empty with nothing invested', async () => {
    expect(await returns()).toMatchObject({ currency: 'INR', parts: [], total: null });
  });

  it('sets market holdings, deposits and gold side by side, and all together', async () => {
    // €1,000 + €5 fees into an ETF 400 days ago, a €20 dividend, worth €1,200 today
    const etf = (
      await call('POST', '/api/holdings', { name: 'World ETF', kind: 'etf', currency: 'EUR' })
    ).json().data;
    await call('POST', `/api/holdings/${etf.id}/trades`, {
      date: ago(400),
      type: 'buy',
      units: '10',
      amount: 100_000,
      fees: 500,
    });
    await call('POST', `/api/holdings/${etf.id}/trades`, {
      date: ago(30),
      type: 'dividend',
      amount: 2_000,
    });
    await call('POST', `/api/holdings/${etf.id}/prices`, { date: today, price: '120' });

    // ₹1 lakh FD at 7 % started 200 days ago, maturing in a year
    const start = ago(200);
    await call('POST', '/api/deposits', {
      kind: 'fd',
      name: 'HDFC',
      currency: 'INR',
      principal: 10_000_000,
      rateBp: 700,
      startDate: start,
      maturityDate: addMonths(start, 12),
      compounding: 'quarterly',
      interest: 'reinvest',
    });

    // 10 g of 24K bought for ₹50,000; ₹6,000 a gram today. A ring with no price paid is left out.
    await prisma.benchmarkPoint.create({
      data: { series: 'gold24k', date: new Date(`${today}T00:00:00Z`), value: 6_000_000_000n },
    });
    await call('POST', '/api/gold', {
      name: 'Coin',
      grams: '10',
      purity: '24k',
      boughtOn: ago(365),
      boughtFor: 5_000_000,
    });
    await call('POST', '/api/gold', { name: 'Ring', grams: '5', purity: '22k' });

    const r = await returns();
    expect(r.parts.map((p: { part: string }) => p.part)).toEqual(['market', 'fd', 'gold']);
    const [market, fd, gold] = r.parts;
    expect(market).toMatchObject({
      count: 1,
      putIn: 10_050_000, // €1,005 at ₹100
      takenOut: 0, // nothing sold
      income: 200_000, // the dividend: earned on top
      worth: 12_000_000,
      gain: 12_000_000 + 200_000 - 10_050_000,
      since: ago(400),
    });
    expect(market.xirrBp).toBeGreaterThan(1_800);
    // what the dividend column is made of: the payment, in rupees and in euros
    expect(market.lines).toEqual([
      {
        date: ago(30),
        name: 'World ETF',
        income: true,
        amount: 200_000,
        own: { amount: 2_000, currency: 'EUR' },
      },
    ]);
    expect(fd).toMatchObject({ count: 1, putIn: 10_000_000, takenOut: 0, income: 0 });
    expect(fd.gain).toBeGreaterThan(0);
    // a deposit's yearly rate is about its interest rate (7 %, a little more compounded)
    expect(fd.xirrBp).toBeGreaterThanOrEqual(700);
    expect(fd.xirrBp).toBeLessThan(730);
    expect(gold).toMatchObject({ count: 1, putIn: 5_000_000, worth: 6_000_000, gain: 1_000_000 });
    expect(gold.xirrBp).toBeCloseTo(2_000, -1);

    expect(r.total).toMatchObject({
      putIn: market.putIn + fd.putIn + gold.putIn,
      worth: market.worth + fd.worth + gold.worth,
      gain: market.gain + fd.gain + gold.gain,
      since: ago(400),
    });
    expect(r.leftOut).toEqual({ market: 0, gold: 1 });

    // in euros: same rates, amounts a hundredth
    const eur = await returns('?currency=EUR');
    expect(eur.currency).toBe('EUR');
    expect(eur.parts[0]).toMatchObject({ part: 'market', putIn: 100_500, worth: 120_000 });
    expect(eur.parts[0].xirrBp).toBe(market.xirrBp);
  });

  it('a deposit paid out counts what came back; one without an exchange rate is set aside', async () => {
    const start = ago(500);
    const id = (
      await call('POST', '/api/deposits', {
        kind: 'fd',
        name: 'SBI',
        currency: 'INR',
        principal: 10_000_000,
        rateBp: 600,
        startDate: start,
        maturityDate: addMonths(start, 12),
        compounding: 'quarterly',
        interest: 'reinvest',
      })
    ).json().data.id;
    await call('PUT', `/api/deposits/${id}`, { closedAt: addMonths(start, 12) });
    await call('POST', '/api/deposits', {
      kind: 'fd',
      name: 'Barclays',
      currency: 'GBP',
      principal: 100_000,
      rateBp: 400,
      startDate: ago(100),
      maturityDate: addMonths(ago(100), 12),
      compounding: 'yearly',
      interest: 'reinvest',
    });
    const r = await returns();
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ part: 'fd', count: 1, worth: 0, putIn: 10_000_000 });
    expect(r.parts[0].takenOut).toBeGreaterThan(10_600_000);
    expect(r.parts[0].xirrBp).toBeGreaterThanOrEqual(600);
    expect(r.unconverted).toEqual([{ currency: 'GBP', amount: expect.any(Number) }]);
    // paid out and without a rate: named by what went in, not as nothing
    const gbp = await returns('?currency=GBP');
    expect(gbp.parts[0]).toMatchObject({ part: 'fd', count: 1, putIn: 100_000 });
    expect(gbp.unconverted).toEqual([{ currency: 'INR', amount: 10_000_000 }]);
  });

  it('leaves out archived holdings still held, keeps archived ones that were sold', async () => {
    const add = async (name: string) =>
      (await call('POST', '/api/holdings', { name, kind: 'stock', currency: 'INR' })).json().data
        .id as string;
    const kept = await add('Kept');
    const sold = await add('Sold');
    for (const id of [kept, sold]) {
      await call('POST', `/api/holdings/${id}/trades`, {
        date: ago(300),
        type: 'buy',
        units: '1',
        amount: 100_000,
      });
    }
    await call('POST', `/api/holdings/${sold}/trades`, {
      date: ago(10),
      type: 'sell',
      units: '1',
      amount: 120_000,
    });
    for (const id of [kept, sold]) await call('PUT', `/api/holdings/${id}`, { archived: true });
    const r = await returns();
    expect(r.parts).toEqual([
      expect.objectContaining({ part: 'market', count: 1, putIn: 100_000, takenOut: 120_000 }),
    ]);
    expect(r.parts[0].lines).toEqual([
      { date: ago(10), name: 'Sold', income: false, amount: 120_000, own: null },
    ]);
  });

  it('gives the value week by week over the last year, from the first week anything was held', async () => {
    expect((await call('GET', '/api/investments/history')).json().data).toEqual({
      currency: 'INR',
      points: [],
    });
    const start = ago(100);
    await call('POST', '/api/deposits', {
      kind: 'fd',
      name: 'HDFC',
      currency: 'INR',
      principal: 10_000_000,
      rateBp: 700,
      startDate: start,
      maturityDate: addMonths(start, 12),
      compounding: 'quarterly',
      interest: 'reinvest',
    });
    // €100 in an ETF 50 days ago, priced at €120 today: ₹12,000 at ₹100 a euro
    const etf = (
      await call('POST', '/api/holdings', { name: 'World ETF', kind: 'etf', currency: 'EUR' })
    ).json().data;
    await call('POST', `/api/holdings/${etf.id}/trades`, {
      date: ago(50),
      type: 'buy',
      units: '1',
      amount: 10_000,
    });
    await call('POST', `/api/holdings/${etf.id}/prices`, { date: today, price: '120' });

    const h = (await call('GET', '/api/investments/history')).json().data;
    const points = h.points as { date: string; value: number }[];
    expect(points.at(-1)!.date).toBe(today);
    expect(points[0]!.date >= start).toBe(true);
    expect(points[0]!.date < addDays(start, 7)).toBe(true);
    expect(points[0]!.value).toBeGreaterThanOrEqual(10_000_000);
    const fdToday = (await call('GET', '/api/deposits')).json().data.deposits[0].value;
    expect(points.at(-1)!.value).toBe(fdToday + 1_200_000);
    // weekly, from the deposit's first week
    expect(points.length).toBeGreaterThanOrEqual(14);
    expect(points.length).toBeLessThanOrEqual(15);
  });

  it('the history keeps an archived holding that was sold, and uses estimated gold rates before IBJA', async () => {
    const id = (
      await call('POST', '/api/holdings', { name: 'Old', kind: 'stock', currency: 'INR' })
    ).json().data.id;
    await call('POST', `/api/holdings/${id}/trades`, {
      date: ago(200),
      type: 'buy',
      units: '1',
      amount: 100_000,
    });
    await call('POST', `/api/holdings/${id}/trades`, {
      date: ago(100),
      type: 'sell',
      units: '1',
      amount: 100_000,
    });
    await call('PUT', `/api/holdings/${id}`, { archived: true });
    // 1 g of 24K held all along; an estimated rate a year ago, IBJA's from 30 days ago
    await call('POST', '/api/gold', { name: 'Coin', grams: '1', purity: '24k' });
    const point = (series: string, date: string, rupees: number) =>
      prisma.benchmarkPoint.create({
        data: { series, date: new Date(`${date}T00:00:00Z`), value: BigInt(rupees * 1_000_000) },
      });
    await point('gold24kEst', ago(400), 5_000);
    await point('gold24k', ago(30), 6_000);

    const points = (await call('GET', '/api/investments/history')).json().data.points as {
      date: string;
      value: number;
    }[];
    const on = (d: string) => points.filter((p) => p.date <= d).at(-1)!.value;
    expect(points[0]!.value).toBe(500_000); // a year ago: the estimate, nothing else held
    expect(on(ago(150))).toBe(100_000 + 500_000); // the share (at its trade price) and the coin
    expect(on(ago(50))).toBe(500_000); // sold
    expect(points.at(-1)!.value).toBe(600_000); // IBJA's rate
  });

  it('needs a login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/investments/returns' });
    expect(res.statusCode).toBe(401);
  });
});

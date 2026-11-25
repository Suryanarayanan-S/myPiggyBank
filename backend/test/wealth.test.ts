import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const L = (lakh: number) => Math.round(lakh * 100_000 * 100);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const thisMonth = new Date().toISOString().slice(0, 7);

describe('wealth API', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let appa: { id: string };
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app, { name: 'Surya' })).cookie);
    appa = (await call('POST', '/api/members', { name: 'Appa' })).json().data;
  });
  afterEach(() => app.close());

  const house = () => ({
    name: 'Jothi ilam',
    assetClass: 'property',
    currency: 'INR',
    ownerMemberId: appa.id,
    value: L(80),
    date: '2024-01-26',
  });

  describe('assets', () => {
    it('creates an asset with an initial valuation', async () => {
      const res = await call('POST', '/api/assets', house());
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({
        name: 'Jothi ilam',
        assetClass: 'property',
        value: L(80),
        valuedAt: '2024-01-26',
      });
      expect((await call('GET', '/api/assets')).json().data).toHaveLength(1);
    });

    it('uses the valuation with the latest date as the current value, even if entered out of order', async () => {
      const id = (await call('POST', '/api/assets', house())).json().data.id;
      await call('POST', `/api/assets/${id}/valuations`, { date: '2026-01-16', value: L(90) });
      const res = await call('POST', `/api/assets/${id}/valuations`, {
        date: '2025-03-10',
        value: L(85),
        note: 'valuer',
      });
      expect(res.json().data).toMatchObject({ value: L(90), valuedAt: '2026-01-16' });
      expect(res.json().data.history.map((h: { date: string }) => h.date)).toEqual([
        '2026-01-16',
        '2025-03-10',
        '2024-01-26',
      ]);
      const latest = res.json().data.history[0].id;
      const after = await call('DELETE', `/api/assets/${id}/valuations/${latest}`);
      expect(after.json().data).toMatchObject({ value: L(85), valuedAt: '2025-03-10' });
    });

    it.each([
      [{ assetClass: 'gold' }],
      [{ currency: 'JPY' }],
      [{ value: -1 }],
      [{ date: '2026-02-30' }],
      [{ name: '' }],
    ])('rejects invalid input %#', async (patch) => {
      expect((await call('POST', '/api/assets', { ...house(), ...patch })).statusCode).toBe(400);
    });

    it('updates and deletes an asset', async () => {
      const id = (await call('POST', '/api/assets', house())).json().data.id;
      const res = await call('PUT', `/api/assets/${id}`, {
        name: 'Family house',
        ownerMemberId: null,
      });
      expect(res.json().data).toMatchObject({ name: 'Family house', ownerMemberId: null });
      expect((await call('DELETE', `/api/assets/${id}`)).statusCode).toBe(200);
      expect(await prisma.assetValuation.count()).toBe(0);
    });
  });

  describe('liabilities', () => {
    const loan = {
      name: 'Car loan',
      type: 'car_loan',
      currency: 'EUR',
      originalAmount: 1_500_000,
      interestRate: '3.75',
      monthlyPayment: 32_000,
      lender: 'Sparkasse',
      startDate: '2025-08-26',
      outstanding: 900_000,
      date: '2026-09-30',
    };

    it('creates a loan with details and outstanding balance history', async () => {
      const res = await call('POST', '/api/liabilities', loan);
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({
        interestRate: '3.75',
        monthlyPayment: 32_000,
        outstanding: 900_000,
        balanceAt: '2026-09-30',
        startDate: '2025-08-26',
      });
      const id = res.json().data.id;
      const next = await call('POST', `/api/liabilities/${id}/balances`, {
        date: '2026-10-31',
        outstanding: 870_000,
      });
      expect(next.json().data).toMatchObject({
        outstanding: 870_000,
        history: [{ outstanding: 870_000 }, { outstanding: 900_000 }],
      });
    });

    it.each([
      [{ interestRate: 'abc' }],
      [{ interestRate: '150' }],
      [{ type: 'gift' }],
      [{ outstanding: -5 }],
    ])('rejects invalid input %#', async (patch) => {
      expect((await call('POST', '/api/liabilities', { ...loan, ...patch })).statusCode).toBe(400);
    });
  });

  describe('net worth', () => {
    it('combines accounts, assets and liabilities in INR, converting EUR with the rate', async () => {
      await call('POST', '/api/assets', house());
      await call('POST', '/api/accounts', {
        name: 'Sparkasse',
        type: 'current',
        currency: 'EUR',
        openingBalance: 250_000,
      });
      await call('POST', '/api/liabilities', {
        name: 'Car loan',
        type: 'car_loan',
        currency: 'EUR',
        outstanding: 500_000,
        date: daysAgo(1),
      });
      await call('PUT', '/api/exchange-rates', {
        month: thisMonth,
        base: 'EUR',
        quote: 'INR',
        rate: '100',
      });
      const d = (await call('GET', '/api/net-worth')).json().data;
      expect(d.current).toMatchObject({
        currency: 'INR',
        assets: L(82.5),
        liabilities: L(5),
        netWorth: L(77.5),
        unconverted: [],
      });
      expect(d.current.columns.map((c: { name: string }) => c.name)).toEqual(['Appa', 'Shared']);
    });

    it('reports EUR amounts when there is no exchange rate', async () => {
      await call('POST', '/api/accounts', {
        name: 'Sparkasse',
        type: 'current',
        currency: 'EUR',
        openingBalance: 250_000,
      });
      const d = (await call('GET', '/api/net-worth')).json().data;
      expect(d.current.unconverted).toEqual([{ currency: 'EUR', amount: 250_000 }]);
    });

    it('keeps past entries from the old sheet; a month and a year ago come from them before the app knew anything', async () => {
      await call('POST', '/api/assets', house());
      await call('POST', '/api/net-worth/snapshots', {
        date: daysAgo(400),
        netWorth: L(135),
        note: 'Initial',
      });
      await call('POST', '/api/net-worth/snapshots', {
        date: daysAgo(40),
        netWorth: L(126),
        note: 'Aarthy marriage withdraw',
      });
      const d = (await call('GET', '/api/net-worth')).json().data;
      expect(d.snapshots.map((s: { note: string }) => s.note)).toEqual([
        'Initial',
        'Aarthy marriage withdraw',
      ]);
      // with the entries' own dates
      expect(d.previousMonth).toMatchObject({ date: daysAgo(40), netWorth: L(126) });
      expect(d.previousYear).toMatchObject({ date: daysAgo(400), netWorth: L(135) });
    });

    it('works out every day from what the app knows — nothing to save', async () => {
      const bank = (
        await call('POST', '/api/accounts', {
          name: 'SBI',
          type: 'savings',
          currency: 'INR',
          openingBalance: L(1),
        })
      ).json().data;
      await call('POST', '/api/transactions', {
        date: daysAgo(100),
        type: 'income',
        amount: L(2),
        accountId: bank.id,
      });
      await call('POST', '/api/transactions', {
        date: daysAgo(10),
        type: 'expense',
        amount: L(0.5),
        accountId: bank.id,
      });
      // a house entered with a value from long ago, revalued since
      const home = (await call('POST', '/api/assets', house())).json().data;
      await call('POST', `/api/assets/${home.id}/valuations`, { date: daysAgo(50), value: L(90) });
      // a loan entered 60 days ago: it was there before too
      await call('POST', '/api/liabilities', {
        name: 'Car loan',
        type: 'car_loan',
        currency: 'INR',
        outstanding: L(5),
        date: daysAgo(60),
      });
      // from before the app: leads up to the first day it knows
      await call('POST', '/api/net-worth/snapshots', { date: daysAgo(300), netWorth: L(70) });

      const h = (await call('GET', '/api/net-worth/history?range=all')).json().data;
      expect(h.currency).toBe('INR');
      expect(h.days[0]).toBe(daysAgo(100)); // the first transaction
      expect(h.earlier).toEqual([{ date: daysAgo(300), value: L(70) }]);
      const on = (day: string) => h.total[h.days.indexOf(day)];
      // 1 + 2 lakh in the bank, the house at 80, the loan of 5
      expect(on(daysAgo(100))).toBe(L(1 + 2 + 80 - 5));
      const now = (await call('GET', '/api/net-worth')).json().data.current.netWorth;
      expect(h.total.at(-1)).toBe(now);
      expect(now).toBe(L(1 + 2 - 0.5 + 90 - 5));
      // a month and a year ago are worked out (the year from before the app: none)
      const d = (await call('GET', '/api/net-worth')).json().data;
      expect(d.previousMonth).toMatchObject({ date: daysAgo(28), netWorth: L(1 + 2 + 90 - 5) });
      expect(d.previousYear).toBeNull();
      expect((await call('GET', '/api/net-worth/history?range=5y')).statusCode).toBe(400);
    });

    it('edits a snapshot note and deletes snapshots', async () => {
      const s = (
        await call('POST', '/api/net-worth/snapshots', {
          date: '2025-08-26',
          netWorth: L(117),
          note: 'Car',
        })
      ).json().data;
      const res = await call('PUT', `/api/net-worth/snapshots/${s.id}`, { note: 'Car withdraw' });
      expect(res.json().data.note).toBe('Car withdraw');
      expect((await call('DELETE', `/api/net-worth/snapshots/${s.id}`)).statusCode).toBe(200);
      expect((await call('GET', '/api/net-worth')).json().data.snapshots).toEqual([]);
    });
  });

  it("isolates families: another family cannot see or change this family's wealth", async () => {
    const asset = (await call('POST', '/api/assets', house())).json().data;
    const loan = (
      await call('POST', '/api/liabilities', {
        name: 'Loan',
        type: 'other',
        currency: 'INR',
        outstanding: 100,
      })
    ).json().data;
    const snap = (
      await call('POST', '/api/net-worth/snapshots', { date: '2025-01-01', netWorth: 1, note: 'x' })
    ).json().data;
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('GET', '/api/assets')).json().data).toEqual([]);
    for (const [method, url, body] of [
      ['PUT', `/api/assets/${asset.id}`, { name: 'Hacked' }],
      ['DELETE', `/api/assets/${asset.id}`, undefined],
      ['POST', `/api/assets/${asset.id}/valuations`, { date: '2026-01-01', value: 1 }],
      ['DELETE', `/api/assets/${asset.id}/valuations/${asset.history[0].id}`, undefined],
      ['PUT', `/api/liabilities/${loan.id}`, { name: 'Hacked' }],
      ['POST', `/api/liabilities/${loan.id}/balances`, { date: '2026-01-01', outstanding: 1 }],
      ['PUT', `/api/net-worth/snapshots/${snap.id}`, { note: 'Hacked' }],
      ['DELETE', `/api/net-worth/snapshots/${snap.id}`, undefined],
    ] as const) {
      const res = await other(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await call('GET', '/api/assets')).json().data[0]).toMatchObject({
      name: 'Jothi ilam',
      value: L(80),
    });
    const ownerFromOther = await other('POST', '/api/assets', { ...house(), name: 'X' });
    expect(ownerFromOther.statusCode).toBe(404);
  });

  it('refuses a currency change once an asset or loan has history (it would rescale every value)', async () => {
    const a = (await call('POST', '/api/assets', house())).json().data;
    const res = await call('PUT', `/api/assets/${a.id}`, { currency: 'EUR' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CURRENCY_LOCKED');
    const fresh = (
      await call('POST', '/api/assets', { name: 'Gold', assetClass: 'other', currency: 'INR' })
    ).json().data;
    expect((await call('PUT', `/api/assets/${fresh.id}`, { currency: 'EUR' })).statusCode).toBe(
      200,
    );
    const loan = (
      await call('POST', '/api/liabilities', {
        name: 'Loan',
        type: 'other',
        currency: 'INR',
        outstanding: 100,
      })
    ).json().data;
    expect(
      (await call('PUT', `/api/liabilities/${loan.id}`, { currency: 'EUR' })).json().error.code,
    ).toBe('CURRENCY_LOCKED');
  });

  it('counts investments at what was put in on every day when the family chose so: no jump today', async () => {
    const etf = (
      await call('POST', '/api/holdings', { name: 'Nifty BeES', kind: 'etf', currency: 'INR' })
    ).json().data;
    await call('POST', `/api/holdings/${etf.id}/trades`, {
      date: daysAgo(60),
      type: 'buy',
      units: '10',
      amount: L(1),
    });
    await call('POST', `/api/holdings/${etf.id}/prices`, { date: daysAgo(60), price: '10000' });
    await call('POST', `/api/holdings/${etf.id}/prices`, { date: daysAgo(1), price: '15000' });
    const worth = (await call('GET', '/api/net-worth/history?range=1m')).json().data;
    expect(worth.total.at(-2)).toBe(L(1.5)); // at the price then
    await call('PUT', '/api/family', { investmentsAt: 'invested' });
    const h = (await call('GET', '/api/net-worth/history?range=1m')).json().data;
    expect(h.total.at(-1)).toBe(L(1));
    expect(h.total.at(-2)).toBe(L(1)); // the day before: at cost too
  });

  it('starts a shorter range from the last past entry before it', async () => {
    const bank = (
      await call('POST', '/api/accounts', { name: 'SBI', type: 'savings', currency: 'INR' })
    ).json().data;
    await call('POST', '/api/transactions', {
      date: daysAgo(10),
      type: 'income',
      amount: L(1),
      accountId: bank.id,
    });
    await call('POST', '/api/net-worth/snapshots', { date: daysAgo(400), netWorth: L(50) });
    await call('POST', '/api/net-worth/snapshots', { date: daysAgo(100), netWorth: L(60) });
    const h = (await call('GET', '/api/net-worth/history?range=6m')).json().data;
    expect(h.days[0]).toBe(daysAgo(10)); // the app's first day
    const start = h.earlier[0].date;
    // the entry from before the range starts it on its first day, then the one inside it
    expect(h.earlier.map((e: { value: number }) => e.value)).toEqual([L(50), L(60)]);
    expect(start < daysAgo(100)).toBe(true);
    const all = (await call('GET', '/api/net-worth/history?range=all')).json().data;
    expect(all.earlier).toEqual([
      { date: daysAgo(400), value: L(50) },
      { date: daysAgo(100), value: L(60) },
    ]);
  });

  it('refuses a past entry dated in the future', async () => {
    const res = await call('POST', '/api/net-worth/snapshots', {
      date: daysAgo(-3),
      netWorth: L(1),
    });
    expect(res.statusCode).toBe(400);
  });

  it('no longer saves a snapshot for today: every day is worked out', async () => {
    const res = await call('POST', '/api/net-worth/snapshots', { note: 'x' });
    expect(res.statusCode).toBe(400);
    expect(await prisma.netWorthSnapshot.count()).toBe(0);
  });

  it.each([[{ date: '2025-01-01' }], [{ date: '2025-01-01', netWorth: '135' }], [{ netWorth: 5 }]])(
    'rejects a malformed past entry instead of saving a snapshot for today %#',
    async (body) => {
      expect((await call('POST', '/api/net-worth/snapshots', body)).statusCode).toBe(400);
      expect(await prisma.netWorthSnapshot.count()).toBe(0);
    },
  );
});

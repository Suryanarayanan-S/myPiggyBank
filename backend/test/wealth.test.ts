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

    it('saves today’s snapshot with a note, and past entries from the old sheet', async () => {
      await call('POST', '/api/assets', house());
      const today = await call('POST', '/api/net-worth/snapshots', {
        note: 'First snapshot in the app',
      });
      expect(today.statusCode).toBe(201);
      expect(today.json().data).toMatchObject({
        netWorth: L(80),
        note: 'First snapshot in the app',
        manual: false,
      });
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
        'First snapshot in the app',
      ]);
      expect(d.previousMonth).toMatchObject({ note: 'Aarthy marriage withdraw' });
      expect(d.previousYear).toMatchObject({ note: 'Initial', manual: true });
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

  it("refuses to save today's snapshot while some amounts cannot be converted", async () => {
    await call('POST', '/api/accounts', {
      name: 'Sparkasse',
      type: 'current',
      currency: 'EUR',
      openingBalance: 250_000,
    });
    const res = await call('POST', '/api/net-worth/snapshots', { note: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('UNCONVERTED_AMOUNTS');
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

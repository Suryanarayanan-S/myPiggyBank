import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { refreshLiveRates, type FetchRates } from '../src/services/liveRateService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

/** A fake Frankfurter: answers /latest and /YYYY-MM-DD with fixed EUR rates, records the URLs. */
function fakeProvider(opts: { latestDate?: string; fail?: boolean; body?: unknown } = {}) {
  const urls: string[] = [];
  const fetchRates: FetchRates = async (url) => {
    urls.push(url);
    if (opts.fail) throw new Error('network down');
    const day = url.match(/\/v1\/(\d{4}-\d{2}-\d{2}|latest)\?/)![1]!;
    const date = day === 'latest' ? (opts.latestDate ?? '2026-10-07') : day;
    const inr = 100 + Number(date.slice(5, 7)); // 2026-09 → 109, 2026-10 → 110
    return {
      ok: true,
      status: 200,
      json: async () =>
        opts.body ?? {
          base: 'EUR',
          date,
          rates: { INR: inr, USD: 1.25, GBP: 0.85, CHF: 0.93, AUD: 1.6, CAD: 1.59, SGD: 1.43 },
        },
    };
  };
  return { urls, fetchRates };
}

describe('live exchange rates', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let provider: ReturnType<typeof fakeProvider>;
  beforeEach(async () => {
    await resetDb();
    provider = fakeProvider();
    app = await makeApp({ fetchRates: provider.fetchRates });
    call = client(app, (await signUp(app)).cookie);
  });
  afterEach(() => app.close());

  async function inrGroceries(date = '2026-09-10') {
    const inr = (
      await call('POST', '/api/accounts', { name: 'ICICI', type: 'savings', currency: 'INR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    await call('POST', '/api/transactions', {
      date,
      amount: 1_090_000, // ₹10,900
      type: 'expense',
      accountId: inr.id,
      categoryId: cats.find((c) => c.name === 'Groceries')!.id,
    });
  }
  const live = (month: string, inr: number) =>
    prisma.liveRate.create({
      data: { month, quote: 'INR', rateMicros: inr * 1_000_000, asOf: `${month}-28`, final: true },
    });
  const budget = async () => (await call('GET', '/api/budget/2026-09')).json().data;

  it('family starts in manual mode and can switch to live', async () => {
    expect((await call('GET', '/api/family')).json().data.rateMode).toBe('manual');
    const res = await call('PUT', '/api/family', { rateMode: 'live' });
    expect(res.json().data.rateMode).toBe('live');
    expect((await call('PUT', '/api/family', { rateMode: 'sometimes' })).statusCode).toBe(400);
  });

  it('manual mode ignores live rates', async () => {
    await inrGroceries();
    await live('2026-09', 109);
    expect((await budget()).unconverted).toEqual([{ currency: 'INR', amount: 1_090_000 }]);
  });

  it('live mode converts with the live rate of the month', async () => {
    await inrGroceries();
    await live('2026-09', 109);
    await call('PUT', '/api/family', { rateMode: 'live' });
    const s = await budget();
    expect(s.unconverted).toEqual([]);
    expect(s.essentials).toBe(10_000); // ₹10,900 / 109
  });

  it('a hand-entered rate wins over the live one for that month', async () => {
    await inrGroceries();
    await live('2026-09', 109);
    await call('PUT', '/api/family', { rateMode: 'live' });
    await call('PUT', '/api/exchange-rates', {
      month: '2026-09',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    expect((await budget()).essentials).toBe(10_900);
  });

  it('the refresh route downloads and reports the status', async () => {
    const res = await call('POST', '/api/exchange-rates/live/refresh');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ asOf: '2026-10-07', lastError: null });
  });

  it('refresh stores the latest rate and backfills month-end rates from the first transaction', async () => {
    await inrGroceries('2026-08-15');
    // A fixed "today", so the test does not depend on the real date.
    const status = await refreshLiveRates(prisma, provider.fetchRates, '2026-10-07');
    expect(status).toMatchObject({ asOf: '2026-10-07', lastError: null });
    expect(provider.urls.some((u) => u.includes('/latest?base=EUR&symbols=INR,USD,GBP'))).toBe(
      true,
    );
    expect(provider.urls.filter((u) => /\/2026-0[89]-3[01]\?/.test(u))).toHaveLength(2);
    const rows = await prisma.liveRate.findMany({
      where: { quote: 'INR' },
      orderBy: { month: 'asc' },
    });
    expect(rows.map((r) => [r.month, r.rateMicros, r.final])).toEqual([
      ['2026-08', 108_000_000, true],
      ['2026-09', 109_000_000, true],
      ['2026-10', 110_000_000, false],
    ]);
  });

  it('fetches a finished month again when its answer lacked a currency', async () => {
    await inrGroceries('2026-09-15');
    const partial = fakeProvider({ body: { date: '2026-09-30', rates: { USD: 1.25 } } });
    await refreshLiveRates(prisma, partial.fetchRates, '2026-10-07');
    provider.urls.length = 0;
    await refreshLiveRates(prisma, provider.fetchRates, '2026-10-08');
    expect(provider.urls.filter((u) => u.includes('/2026-09-30?'))).toHaveLength(1);
  });

  it('rejects a rate too small to store, keeping everything else', async () => {
    const tiny = fakeProvider({ body: { date: '2026-10-07', rates: { INR: 110, SGD: 1e-7 } } });
    const status = await refreshLiveRates(prisma, tiny.fetchRates, '2026-10-07');
    expect(status.lastError).toMatch(/unexpected answer/i);
    expect(await prisma.liveRate.count()).toBe(0);
  });

  it('a hand-entered EUR rate also steers cross rates of that month', async () => {
    const usd = (
      await call('POST', '/api/accounts', { name: 'Chase', type: 'current', currency: 'USD' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    await call('POST', '/api/transactions', {
      date: '2026-09-10',
      amount: 12_500, // $125
      type: 'expense',
      accountId: usd.id,
      categoryId: cats.find((c) => c.name === 'Groceries')!.id,
    });
    await prisma.liveRate.createMany({
      data: [
        { month: '2026-09', quote: 'INR', rateMicros: 90_000_000, asOf: '2026-09-30', final: true },
        { month: '2026-09', quote: 'USD', rateMicros: 1_250_000, asOf: '2026-09-30', final: true },
      ],
    });
    await call('PUT', '/api/family', { rateMode: 'live' });
    await call('PUT', '/api/exchange-rates', {
      month: '2026-09',
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    const s = (await call('GET', '/api/budget/2026-09?currency=INR')).json().data;
    expect(s.essentials).toBe(1_000_000); // $125 → €100 → ₹10,000 at the user's own 100
  });

  it('does not fetch a finished month twice', async () => {
    await inrGroceries('2026-09-15');
    await refreshLiveRates(prisma, provider.fetchRates, '2026-10-07');
    provider.urls.length = 0;
    await refreshLiveRates(prisma, provider.fetchRates, '2026-10-08');
    expect(provider.urls).toHaveLength(1); // only "latest"
  });

  it('keeps old rates and reports the error when the provider is down', async () => {
    await live('2026-09', 109);
    const down = fakeProvider({ fail: true });
    const status = await refreshLiveRates(prisma, down.fetchRates, '2026-10-07');
    expect(status.lastError).toMatch(/network down/);
    expect(await prisma.liveRate.count()).toBe(1);
    expect((await call('GET', '/api/exchange-rates/live')).json().data).toMatchObject({
      asOf: '2026-09-28',
      lastError: expect.stringMatching(/network down/),
    });
  });

  it('rejects a malformed answer without storing anything', async () => {
    const bad = fakeProvider({ body: { date: '2026-10-07', rates: { INR: -5 } } });
    const status = await refreshLiveRates(prisma, bad.fetchRates, '2026-10-07');
    expect(status.lastError).toMatch(/unexpected answer/i);
    expect(await prisma.liveRate.count()).toBe(0);
  });

  it('says so when the server has no internet access configured', async () => {
    const offline = await makeApp();
    const c = client(offline, (await signUp(offline)).cookie);
    const res = await c('POST', '/api/exchange-rates/live/refresh');
    expect(res.statusCode).toBe(503);
    await offline.close();
  });
});

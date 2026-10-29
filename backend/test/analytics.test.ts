import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FetchText } from '../src/services/livePriceService.js';
import { forgetEcbAttempts } from '../src/services/analyticsService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const SRC = { onvista: 'https://ov.test/api', ecb: 'https://ecb.test/EXR' };

/** A fake ECB: dollars and rupees per euro, 23 and 26 Oct 2026. */
function fakeEcb(down = false) {
  const urls: string[] = [];
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    // onvista's currency quotes (FactSet, delayed)
    const pair = url.match(/instruments\/CURRENCY\/(\w+)\/snapshot/)?.[1];
    if (pair) {
      if (down) return { ok: false, status: 503, text: async () => '' };
      const last = { EURINR: 106.05, USDINR: 95.25, EURUSD: 1.1136 }[pair];
      const body = JSON.stringify({
        quote: { last, datetimeLast: '2026-10-29T10:00:03.818+00:00' },
      });
      return { ok: true, status: 200, text: async () => body };
    }
    if (!url.startsWith(SRC.ecb)) return { ok: false, status: 404, text: async () => '' };
    if (down) return { ok: false, status: 503, text: async () => '' };
    const body = [
      'KEY,FREQ,CURRENCY,TIME_PERIOD,OBS_VALUE',
      'x,D,USD,2026-10-23,1.10',
      'x,D,USD,2026-10-26,1.12',
      'x,D,INR,2026-10-23,99',
      'x,D,INR,2026-10-26,100.8',
    ].join('\n');
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetchText, urls };
}

describe('Analytics: currencies', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let ecb: ReturnType<typeof fakeEcb>;
  beforeEach(async () => {
    await resetDb();
    forgetEcbAttempts();
    ecb = fakeEcb();
    app = await makeApp({ fetchPrices: ecb.fetchText, worldSources: SRC });
    call = client(app, (await signUp(app)).cookie);
  });
  afterEach(() => app.close());

  it('gives the ECB rates, fetched when asked and then at most hourly', async () => {
    const d = (await call('GET', '/api/analytics/currencies')).json().data;
    expect(d.asOf).toBe('2026-10-26');
    expect(d.series).toEqual([
      { date: '2026-10-23', usdPerEur: 1.1, inrPerEur: 99 },
      { date: '2026-10-26', usdPerEur: 1.12, inrPerEur: 100.8 },
    ]);
    expect(d.refreshError).toBeNull();
    await call('GET', '/api/analytics/currencies');
    expect(ecb.urls.filter((u) => u.startsWith(SRC.ecb))).toHaveLength(1);
    // an hour later: asked again
    await prisma.fetchMark.update({
      where: { name: 'ecb-rates' },
      data: { day: new Date(Date.now() - 61 * 60_000) },
    });
    await call('GET', '/api/analytics/currencies');
    expect(ecb.urls.filter((u) => u.startsWith(SRC.ecb))).toHaveLength(2);
  });

  it("compares the family's euro⇄rupee transfers with the ECB rate of their day", async () => {
    const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
    const eur = await acc({ name: 'Sparkasse', type: 'current', currency: 'EUR' });
    const inr = await acc({ name: 'ICICI', type: 'savings', currency: 'INR' });
    const usd = await acc({ name: 'Wise USD', type: 'current', currency: 'USD' });
    const gbp = await acc({ name: 'Monzo', type: 'current', currency: 'GBP' });
    const send = (from: string, to: string, amount: number, transferAmount: number) =>
      call('POST', '/api/transactions', {
        date: '2026-10-26',
        type: 'transfer',
        amount,
        transferAmount,
        accountId: from,
        transferAccountId: to,
      });
    await send(eur.id, inr.id, 100_000, 9_980_000); // 1,000 € → ₹99,800 (ECB: ₹1,00,800)
    await send(gbp.id, eur.id, 10_000, 11_500); // pounds: not among the rates, left out
    await send(eur.id, usd.id, 10_000, 11_200); // at the market rate exactly
    const d = (await call('GET', '/api/analytics/currencies')).json().data;
    expect(d.transfers).toEqual([
      expect.objectContaining({
        date: '2026-10-26',
        from: 'EUR',
        to: 'USD',
        sent: 10_000,
        received: 11_200,
        diff: 0,
      }),
      expect.objectContaining({
        from: 'EUR',
        to: 'INR',
        fromAccount: 'Sparkasse',
        toAccount: 'ICICI',
        sent: 100_000,
        received: 9_980_000,
        marketRate: 100.8,
        diff: -100_000,
      }),
    ]);
  });

  it('a failed ask is said on every view until one succeeds, not only the first', async () => {
    const down = fakeEcb(true);
    const a = await makeApp({ fetchPrices: down.fetchText, worldSources: SRC });
    const c = client(a, (await signUp(a)).cookie);
    for (let i = 0; i < 2; i++)
      expect((await c('GET', '/api/analytics/currencies')).json().data.refreshError).toMatch(
        /ECB could not be reached \(the ECB answered 503\)/,
      );
    expect(down.urls.filter((u) => u.startsWith(SRC.ecb))).toHaveLength(1);
    await a.close();
  });

  it('counts the transfers from before the first rate kept, without comparing them', async () => {
    const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
    const eur = await acc({ name: 'Sparkasse', type: 'current', currency: 'EUR' });
    const inr = await acc({ name: 'ICICI', type: 'savings', currency: 'INR' });
    await call('POST', '/api/transactions', {
      date: '2019-06-01',
      type: 'transfer',
      amount: 100_000,
      transferAmount: 7_800_000,
      accountId: eur.id,
      transferAccountId: inr.id,
    });
    const d = (await call('GET', '/api/analytics/currencies')).json().data;
    expect(d).toMatchObject({ transfers: [], uncompared: 1 });
  });

  it('quotes the three pairs during the day (onvista), asking at most every five minutes', async () => {
    const live = async () => (await call('GET', '/api/analytics/currencies/live')).json().data;
    expect(await live()).toEqual({
      quotes: [
        { pair: 'EURINR', rate: 106.05, at: '2026-10-29T10:00:03.818Z' },
        { pair: 'USDINR', rate: 95.25, at: '2026-10-29T10:00:03.818Z' },
        { pair: 'EURUSD', rate: 1.1136, at: '2026-10-29T10:00:03.818Z' },
      ],
      error: null,
    });
    await live();
    expect(ecb.urls.filter((u) => u.includes('/CURRENCY/'))).toHaveLength(3);
  });

  it('says when the quotes during the day cannot be had (the daily rates stay)', async () => {
    const down = fakeEcb(true);
    const a = await makeApp({ fetchPrices: down.fetchText, worldSources: SRC });
    const c = client(a, (await signUp(a)).cookie);
    const d = (await c('GET', '/api/analytics/currencies/live')).json().data;
    expect(d.quotes).toEqual([]);
    expect(d.error).toMatch(/onvista/);
    await a.close();
  });

  it('without a way online (or before any rate): says so, no rates', async () => {
    const offline = await makeApp();
    const c = client(offline, (await signUp(offline)).cookie);
    const d = (await c('GET', '/api/analytics/currencies')).json().data;
    expect(d).toMatchObject({ asOf: null, series: [], transfers: [] });
    await offline.close();
  });
});

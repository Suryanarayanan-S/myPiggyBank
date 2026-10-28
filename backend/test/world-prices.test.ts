import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FetchText } from '../src/services/livePriceService.js';
import { benchmarks, inEuros } from '../src/services/livePriceService.js';
import {
  forgetWorldPrices,
  refreshWorldPrices,
  worldStatus,
  WORLD_BENCHMARKS,
} from '../src/services/worldPriceService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const TODAY = '2026-01-09';
const SRC = { onvista: 'https://ov.test/api', ecb: 'https://ecb.test/EXR' };
const noon = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;

/**
 * A fake onvista: Toyota (JP3633400001) quoted in euros on Tradegate, with a split on
 * 2026-01-07 when `split` is set; each benchmark ETF; daily closes 5–9 Jan 2026 (the split day
 * onward at a fifth). The ECB: dollars per euro those days.
 */
function fake(opts: { split?: boolean; price?: number; ecb?: string } = {}) {
  const urls: string[] = [];
  const isins = ['JP3633400001', ...WORLD_BENCHMARKS.map((b) => b.isin)];
  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    const search = url.match(/searchValue=(\w+)/);
    if (search) {
      const isin = search[1]!;
      return ok({
        facets: isins.includes(isin)
          ? [{ results: [{ entityType: 'STOCK', entityValue: `e-${isin}`, name: isin, isin }] }]
          : [],
      });
    }
    const snap = url.match(/ISIN:(\w+)\/snapshot/);
    if (snap) {
      return ok({
        quoteList: {
          list: [
            { market: { name: 'Tokyo', codeExchange: 'TYO', idNotation: 1 }, isoCurrency: 'JPY' },
            {
              market: { name: 'Tradegate BSX', codeExchange: 'GAT', idNotation: 2 },
              isoCurrency: 'EUR',
            },
          ],
        },
        stocksSplitList: opts.split
          ? { list: [{ dateSplit: '2026-01-07T12:00:00.000+00:00', factor: 5 }] }
          : null,
      });
    }
    const eod = url.match(/eod_history\?idNotation=2&range=Y5&startDate=([\d-]+)/);
    if (eod) {
      const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'].filter(
        (d) => d >= eod[1]!,
      );
      return ok({
        datetimeLast: days.map(noon),
        // onvista's history comes adjusted: all at a fifth once there is a split
        last: days.map(() => opts.price ?? (opts.split ? 4 : 20)),
      });
    }
    if (url.startsWith(SRC.ecb)) {
      return ok(
        opts.ecb ??
          ['KEY,FREQ,TIME_PERIOD,OBS_VALUE', 'x,D,2026-01-05,1.10', 'x,D,2026-01-08,1.25'].join(
            '\n',
          ),
      );
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  return { fetchText, urls };
}

describe('world prices (onvista)', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let family: string;
  let toyota: string;
  beforeEach(async () => {
    await resetDb();
    forgetWorldPrices();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    family = (await call('GET', '/api/family')).json().data.id;
    await prisma.family.update({ where: { id: family }, data: { livePrices: true } });
    toyota = (
      await call('POST', '/api/holdings', {
        name: 'Toyota',
        kind: 'stock',
        symbol: 'JP3633400001',
        currency: 'EUR',
      })
    ).json().data.id;
    await call('POST', `/api/holdings/${toyota}/trades`, {
      date: '2026-01-06',
      type: 'buy',
      units: '2',
      amount: 4_000,
    });
  });
  afterEach(() => app.close());

  it('gives a held world share its daily closes in its currency, then only the new ones', async () => {
    const f = fake();
    expect(await refreshWorldPrices(prisma, f.fetchText, TODAY, SRC, 0)).toEqual([]);
    const prices = await prisma.holdingPrice.findMany({
      where: { holdingId: toyota },
      orderBy: { date: 'asc' },
    });
    // from the first trade on, up to yesterday (today's is the price of the moment)
    expect(
      prices.map((p) => [p.date.toISOString().slice(0, 10), Number(p.price), p.source]),
    ).toEqual([
      ['2026-01-06', 20_000_000, 'onvista'],
      ['2026-01-07', 20_000_000, 'onvista'],
      ['2026-01-08', 20_000_000, 'onvista'],
    ]);
    expect(worldStatus(family)).toMatchObject({ updated: 1, notFound: [], lastError: null });
    const h = (await call('GET', '/api/holdings')).json().data.holdings[0];
    expect(h.value).toBe(4_000);
    // again: the instrument is known, and only days after the last close are asked for
    const g = fake();
    await refreshWorldPrices(prisma, g.fetchText, '2026-01-10', SRC, 0);
    expect(g.urls.some((u) => u.includes('searchValue=JP3633400001'))).toBe(false);
    expect(g.urls.some((u) => u.includes('idNotation=2&range=Y5&startDate=2026-01-09'))).toBe(true);
  });

  it('applies a split once: the trades before it in the new units', async () => {
    await call('PUT', `/api/holdings/${toyota}`, { name: 'Toyota' });
    await prisma.holdingPrice.create({
      data: {
        holdingId: toyota,
        date: new Date('2026-01-06T00:00:00Z'),
        price: 20_000_000,
        source: 'manual',
        createdAt: new Date('2026-01-06T10:00:00Z'),
      },
    });
    expect(
      await refreshWorldPrices(prisma, fake({ split: true }).fetchText, TODAY, SRC, 0),
    ).toEqual([]);
    await refreshWorldPrices(prisma, fake({ split: true }).fetchText, TODAY, SRC, 0);
    const h = (await call('GET', '/api/holdings')).json().data.holdings[0];
    expect(h.units).toBe('10');
    expect(h.value).toBe(4_000); // 10 × €4
    const actions = await prisma.holdingAction.findMany({ where: { holdingId: toyota } });
    expect(actions).toEqual([
      expect.objectContaining({ purpose: 'Split 1:5', status: 'applied', num: 5, den: 1 }),
    ]);
    // the price typed before the split, in the new units
    const typed = await prisma.holdingPrice.findFirst({
      where: { holdingId: toyota, source: 'manual' },
    });
    expect(Number(typed!.price)).toBe(4_000_000);
  });

  it('leaves a factor that is no split (a spin-off adjustment) for the user to check', async () => {
    const f = fake({ split: true });
    const odd: typeof f.fetchText = async (url) => {
      const res = await f.fetchText(url);
      if (!url.includes('/snapshot')) return res;
      const body = (await res.text()).replace('"factor":5', '"factor":1.04072243');
      return { ...res, text: async () => body };
    };
    await refreshWorldPrices(prisma, odd, TODAY, SRC, 0);
    expect((await call('GET', '/api/holdings')).json().data.holdings[0].units).toBe('2');
    expect(await prisma.holdingAction.findMany({ where: { holdingId: toyota } })).toEqual([
      expect.objectContaining({
        purpose: 'Price adjustment ×1.04072243 (onvista)',
        status: 'review',
      }),
    ]);
  });

  it('looks for a new split when a close jumps from the last one kept', async () => {
    // known without a split, closes at €20 up to the 6th
    await refreshWorldPrices(prisma, fake().fetchText, '2026-01-07', SRC, 0);
    // two days later onvista lists a 1:5 split and closes at €4: looked up again at once
    const f = fake({ split: true });
    await refreshWorldPrices(prisma, f.fetchText, TODAY, SRC, 0);
    expect(f.urls.some((u) => u.includes('ISIN:JP3633400001/snapshot'))).toBe(true);
    expect((await call('GET', '/api/holdings')).json().data.holdings[0].units).toBe('10');
  });

  it('keeps the last price when a close jumps with no split listed, and says so to its family only', async () => {
    await refreshWorldPrices(prisma, fake().fetchText, '2026-01-07', SRC, 0);
    // halved, no split: a split listed late, or a crash — waits (a week at most)
    await refreshWorldPrices(prisma, fake({ price: 9 }).fetchText, TODAY, SRC, 0);
    const prices = await prisma.holdingPrice.findMany({ where: { holdingId: toyota } });
    expect(prices.map((p) => Number(p.price))).toEqual([20_000_000]);
    expect(worldStatus(family).lastError).toMatch(/Toyota: the price moved ×0.45/);
    // another family sees nothing of it
    const other = client(app, (await signUp(app)).cookie);
    const theirs = (await other('GET', '/api/family')).json().data.id;
    await prisma.family.update({ where: { id: theirs }, data: { livePrices: true } });
    await refreshWorldPrices(prisma, fake({ price: 9 }).fetchText, TODAY, SRC, 0);
    expect(worldStatus(theirs).lastError).toBeNull();
    // after a week it is taken as the price it is
    await refreshWorldPrices(prisma, fake({ price: 9 }).fetchText, '2026-01-20', SRC, 0);
    expect((await call('GET', '/api/holdings')).json().data.holdings[0].value).toBe(1_800);
  });

  it('keeps the euro markets and gold in euros for the comparison', async () => {
    await refreshWorldPrices(prisma, fake().fetchText, TODAY, SRC, 0);
    await prisma.benchmarkPoint.createMany({
      data: [
        { series: 'goldUsd', date: new Date('2026-01-06T00:00:00Z'), value: 2_200_000_000 },
        { series: 'goldUsd', date: new Date('2026-01-08T00:00:00Z'), value: 2_500_000_000 },
      ],
    });
    const b = await benchmarks(prisma);
    expect(b.msciWorld.map((p) => p.date)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
    ]);
    expect(b.nikkei225).toHaveLength(4);
    // $2,200 at 1.10 → €2,000; $2,500 at 1.25 → €2,000
    expect(b.goldEur).toEqual([
      { date: '2026-01-06', value: 2000 },
      { date: '2026-01-08', value: 2000 },
    ]);
    expect(
      inEuros([{ date: '2019-01-01', value: 1 }], [{ date: '2020-01-01', value: 1.1 }]),
    ).toEqual([]);
  });

  it('no new ECB rate yet (it answers with nothing at all) is no error', async () => {
    expect(await refreshWorldPrices(prisma, fake({ ecb: '' }).fetchText, TODAY, SRC, 0)).toEqual(
      [],
    );
    // something that is no rates is still said
    const odd = await refreshWorldPrices(prisma, fake({ ecb: '<html>' }).fetchText, TODAY, SRC, 0);
    expect(odd.join()).toMatch(/something else than its rates/);
  });

  it('says which ISINs onvista does not quote, and asks nothing for families without prices', async () => {
    await prisma.holding.update({ where: { id: toyota }, data: { symbol: 'US0000000000' } });
    await refreshWorldPrices(prisma, fake().fetchText, TODAY, SRC, 0);
    expect(worldStatus(family).notFound).toEqual(['US0000000000']);
    await prisma.family.update({ where: { id: family }, data: { livePrices: false } });
    const f = fake();
    await refreshWorldPrices(prisma, f.fetchText, TODAY, SRC, 0);
    expect(f.urls).toEqual([]);
  });
});

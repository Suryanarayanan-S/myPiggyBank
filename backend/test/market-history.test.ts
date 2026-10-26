import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FetchText } from '../src/services/livePriceService.js';
import {
  backfillHistory,
  includeKnownSplits,
  weeklyHistory,
} from '../src/services/marketHistoryService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const HEAD =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const TODAY = '2026-10-26';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A fake NSE archive: the files of 5 Jan 2024 (a Friday) and of Thursday 11 Jan (the Friday after
 * was a holiday); INFY (before its 1:1 bonus) and GOLDBEES; Nifty 50 those days; no history.
 */
function fakeNse() {
  const urls: string[] = [];
  const files: Record<string, string[]> = {
    '05012024': ['INFY 1400.00', 'GOLDBEES 52.00', 'TATAMOTORS 700.00'],
    '11012024': ['INFY 1420.00', 'GOLDBEES 53.00', 'TATAMOTORS 710.00'],
  };
  const nifty: Record<string, string> = { '05012024': '21710.80', '11012024': '21647.20' };
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    const notFound = { ok: false, status: 404, text: async () => '' };
    if (url.includes('/history')) return { ok: true, status: 200, text: async () => '[]' };
    if (url.endsWith('/gold-history')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            { date: '2023-11-01', price: 1980, source: 'worldbank' },
            { date: '2023-12-01', price: 2030, source: 'worldbank' },
            { date: '2024-01-01', price: 2040, source: 'worldbank' },
            { date: '2024-01-15', price: 2050, source: 'yahoo_finance' },
          ]),
      };
    }
    const b = url.match(/sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/);
    if (b && files[`${b[1]}${b[2]}${b[3]}`]) {
      const date = `${b[1]}-${MONTHS[Number(b[2]) - 1]}-${b[3]}`;
      const rows = files[`${b[1]}${b[2]}${b[3]}`]!.map((x) => {
        const [sym, close] = x.split(' ');
        return `${sym}, EQ, ${date}, 1, 1, 1, 1, 1, ${close}, 1, 1, 1, 1, 1, 1`;
      });
      return { ok: true, status: 200, text: async () => [HEAD, ...rows].join('\n') };
    }
    const i = url.match(/ind_close_all_(\d{2})(\d{2})(\d{4})\.csv$/);
    if (i && nifty[`${i[1]}${i[2]}${i[3]}`]) {
      const text = [
        'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value',
        `Nifty 50,${i[1]}-${i[2]}-${i[3]},1,1,1,${nifty[`${i[1]}${i[2]}${i[3]}`]}`,
      ].join('\n');
      return { ok: true, status: 200, text: async () => text };
    }
    return notFound;
  };
  return { urls, fetchText };
}

describe('market history back to the first trade', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let nse: ReturnType<typeof fakeNse>;
  let familyId: string;
  let infy: string;
  const src = () => ({
    fetch: nse.fetchText,
    historyUrl: 'http://nse.test/history',
    pricesUrl: 'http://nse.test/products/content',
    goldHistoryUrl: 'http://gold.test/gold-history',
    pauseMs: 0,
  });
  const holding = async (symbol: string) =>
    (
      await call('POST', '/api/holdings', {
        name: symbol,
        kind: 'stock',
        symbol,
        currency: 'INR',
      })
    ).json().data.id as string;

  beforeEach(async () => {
    await resetDb();
    nse = fakeNse();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    familyId = (await prisma.family.findFirstOrThrow()).id;
    await prisma.family.update({ where: { id: familyId }, data: { livePrices: true } });
    // 10 shares in today's units: 5 bought, doubled by the 1:1 bonus of 3 Jun 2024
    infy = await holding('INFY');
    await call('POST', `/api/holdings/${infy}/trades`, {
      date: '2024-01-02',
      type: 'buy',
      units: '10',
      amount: 1_390_000,
    });
    await prisma.corporateAction.create({
      data: {
        symbol: 'INFY',
        exDate: new Date('2024-06-03'),
        purpose: 'Bonus 1:1',
        kind: 'bonus',
        num: 2,
        den: 1,
        source: 'history',
      },
    });
  });
  afterEach(() => app.close());

  const prices = async (id: string) =>
    (
      await prisma.holdingPrice.findMany({ where: { holdingId: id }, orderBy: { date: 'asc' } })
    ).map((p) => [p.date.toISOString().slice(0, 10), Number(p.price) / 1_000_000]);

  it('records a bonus the trades already show, and restates the closes before it once', async () => {
    await prisma.holdingPrice.create({
      data: { holdingId: infy, date: new Date('2024-05-31'), price: 1_500_000_000, source: 'nse' },
    });
    expect(await includeKnownSplits(prisma, [familyId], TODAY)).toBe(1);
    expect(await includeKnownSplits(prisma, [familyId], TODAY)).toBe(0);
    expect(await prices(infy)).toEqual([['2024-05-31', 750]]);
    const action = await prisma.holdingAction.findFirstOrThrow({ where: { holdingId: infy } });
    expect(action).toMatchObject({
      status: 'included',
      unitsBefore: 5_000_000n,
      unitsAfter: 10_000_000n,
    });
  });

  it('leaves a bonus kept as a lot of its own alone', async () => {
    await prisma.holdingTrade.updateMany({
      where: { holdingId: infy },
      data: { units: 5_000_000n },
    });
    await prisma.holdingTrade.create({
      data: {
        holdingId: infy,
        date: new Date('2024-06-04'),
        type: 'buy',
        units: 5_000_000n,
        amount: 0n,
      },
    });
    expect(await includeKnownSplits(prisma, [familyId], TODAY)).toBe(0);
  });

  it('leaves recent, upcoming and listed splits to the daily list, and never doubles one', async () => {
    const tcs = await holding('TCS');
    await call('POST', `/api/holdings/${tcs}/trades`, {
      date: '2024-01-02',
      type: 'buy',
      units: '4',
      amount: 1_500_000,
    });
    const action = (symbol: string, exDate: string, source: string) =>
      prisma.corporateAction.create({
        data: {
          symbol,
          exDate: new Date(exDate),
          purpose: `Split ${exDate}`,
          kind: 'split',
          num: 2,
          den: 1,
          source,
        },
      });
    await action('TCS', '2026-11-02', 'list'); // announced for next week
    await action('TCS', '2026-10-01', 'history'); // recent: the daily list's to apply
    await action('TCS', '2025-03-03', 'history'); // the list had it too (worded differently)
    await action('TCS', '2025-03-04', 'list');
    // INFY's bonus has a split left to check close to it
    await prisma.holdingAction.create({
      data: {
        holdingId: infy,
        exDate: new Date('2024-06-05'),
        purpose: 'BONUS 1:1',
        kind: 'bonus',
        status: 'review',
        unitsBefore: 10_000_000n,
        unitsAfter: 10_000_000n,
      },
    });
    expect(await includeKnownSplits(prisma, [familyId], TODAY)).toBe(0);
  });

  it('tries a week once: a share NSE never lists costs nothing later', async () => {
    const sme = await holding('NOTLISTED');
    await call('POST', `/api/holdings/${sme}/trades`, {
      date: '2024-01-02',
      type: 'buy',
      units: '1',
      amount: 10_000,
    });
    await weeklyHistory(prisma, src(), [familyId], '2024-01-15');
    const asked = nse.urls.filter((u) => u.includes('sec_bhavdata')).length;
    await weeklyHistory(prisma, src(), [familyId], '2024-01-15');
    expect(nse.urls.filter((u) => u.includes('sec_bhavdata')).length).toBe(asked);
    expect(await prices(sme)).toEqual([]);
  });

  it('keeps going when NSE fails: the gold history and estimates still come', async () => {
    const failing: FetchText = async (url) =>
      url.includes('sec_bhavdata')
        ? { ok: false, status: 503, text: async () => '' }
        : nse.fetchText(url);
    for (const [series, value] of [
      ['gold24k', 6_300_000_000],
      ['gold22k', 5_770_000_000],
      ['gold', 54_000_000],
    ] as const) {
      await prisma.benchmarkPoint.create({ data: { series, date: new Date('2024-01-15'), value } });
    }
    await prisma.benchmarkPoint.create({
      data: { series: 'gold', date: new Date('2024-01-05'), value: 52_000_000 },
    });
    const r = await backfillHistory(prisma, { ...src(), fetch: failing }, '2024-01-16');
    expect(r.weeks).toBe(0);
    expect(r.errors).toEqual(['weeks: 2 could not be downloaded']);
    expect(r.worldGold).toBe(3); // none collected yet: up to today
    expect(r.estimated).toBe(1);
  });

  it('fills one day a week in the trades’ units, a holiday Friday from the Thursday', async () => {
    await includeKnownSplits(prisma, [familyId], TODAY);
    expect(await weeklyHistory(prisma, src(), [familyId], '2024-01-15')).toEqual({
      filled: 2,
      failed: 0,
    });
    // NSE's closes before the bonus, halved to today's units
    expect(await prices(infy)).toEqual([
      ['2024-01-05', 700],
      ['2024-01-11', 710],
    ]);
    const points = await prisma.benchmarkPoint.findMany({
      orderBy: [{ series: 'asc' }, { date: 'asc' }],
    });
    expect(
      points.map((p) => [p.series, p.date.toISOString().slice(0, 10), Number(p.value) / 1e6]),
    ).toEqual([
      ['gold', '2024-01-05', 52],
      ['gold', '2024-01-11', 53],
      ['nifty50', '2024-01-05', 21710.8],
      ['nifty50', '2024-01-11', 21647.2],
    ]);
    // all there: nothing asked again
    const asked = nse.urls.length;
    expect(await weeklyHistory(prisma, src(), [familyId], '2024-01-15')).toEqual({
      filled: 0,
      failed: 0,
    });
    expect(nse.urls.filter((u) => !u.includes('/history')).length).toBe(
      nse.urls.slice(0, asked).filter((u) => !u.includes('/history')).length,
    );
  });

  it('finds a renamed share’s closes under its former symbol', async () => {
    const tmpv = await holding('TMPV');
    await call('POST', `/api/holdings/${tmpv}/trades`, {
      date: '2024-01-03',
      type: 'buy',
      units: '1',
      amount: 69_000,
    });
    await prisma.symbolAlias.create({ data: { symbol: 'TMPV', former: 'TATAMOTORS' } });
    await weeklyHistory(prisma, src(), [familyId], '2024-01-15');
    expect(await prices(tmpv)).toEqual([
      ['2024-01-05', 700],
      ['2024-01-11', 710],
    ]);
  });

  it('adds the world gold history before the daily collection, and estimates 22K/24K', async () => {
    // collected daily from 15 Jan: IBJA and the world price
    for (const [series, value] of [
      ['goldUsd', 2_050_000_000],
      ['gold24k', 6_300_000_000],
      ['gold22k', 5_770_000_000],
    ] as const) {
      await prisma.benchmarkPoint.create({ data: { series, date: new Date('2024-01-15'), value } });
    }
    await prisma.benchmarkPoint.create({
      data: { series: 'gold', date: new Date('2024-01-15'), value: 54_000_000 },
    });
    const r = await backfillHistory(prisma, src(), '2024-01-16');
    expect(r).toMatchObject({ weeks: 2, worldGold: 2 });
    const data = (await call('GET', '/api/holdings/benchmarks')).json().data;
    // monthly averages from a month before the first trade, then the collected days
    expect(data.goldUsd.map((p: { date: string }) => p.date)).toEqual([
      '2023-12-01',
      '2024-01-01',
      '2024-01-15',
    ]);
    // estimated from GOLDBEES before IBJA's first day: 52 × (6300 ÷ 54)
    expect(data.gold24k[0]).toEqual({ date: '2024-01-05', value: expect.closeTo(6066.67, 1) });
    expect(data.gold24k.at(-1)).toEqual({ date: '2024-01-15', value: 6300 });
    expect(data.estimatedUntil).toBe('2024-01-15');
    // read once
    expect((await backfillHistory(prisma, src(), '2024-01-16')).worldGold).toBe(0);
  });
});

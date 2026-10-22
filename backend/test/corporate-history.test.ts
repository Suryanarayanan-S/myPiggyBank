import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { FetchText } from '../src/services/livePriceService.js';
import { todayLocal } from '../src/lib/dates.js';
import { checkAllDividends, checkDividends } from '../src/services/corporateHistoryService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const HEAD =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A fake NSE: the history of INFY and HDFCBANK (a dividend before and after its 1:1 bonus), none
 * for SCTL (BSE only), and daily files around the bonus (HDFCBANK 2000 before, 1000 on the day).
 */
function fakeNse() {
  const urls: string[] = [];
  const history: Record<string, object[]> = {
    INFY: [
      { symbol: 'INFY', exDate: '21-Oct-2021', subject: 'Interim Dividend - Rs 16.50 Per Share' },
    ],
    HDFCBANK: [
      { symbol: 'HDFCBANK', exDate: '27-Jun-2025', subject: 'Dividend - Rs 22 Per Share' },
      { symbol: 'HDFCBANK', exDate: '26-Aug-2025', subject: 'Bonus 1:1' },
      { symbol: 'HDFCBANK', exDate: '19-Jun-2026', subject: 'Dividend - Rs 13 Per Share' },
    ],
    // a bonus whose free shares are a lot of their own (as Paytm Money records them)
    WIPRO: [
      { symbol: 'WIPRO', exDate: '01-Jul-2024', subject: 'Dividend - Re 1 Per Share' },
      { symbol: 'WIPRO', exDate: '03-Dec-2024', subject: 'Bonus 1:1' },
    ],
    // renamed when it demerged: the older entries come under the former symbol
    TMPV: [
      { symbol: 'TATAMOTORS', exDate: '04-Jun-2025', subject: 'Dividend - Rs 6 Per Share' },
      { symbol: 'TMPV', exDate: '14-Oct-2025', subject: 'Demerger' },
    ],
  };
  const closes: Record<string, string[]> = {
    '25082025': ['HDFCBANK 2000.00'],
    '26082025': ['HDFCBANK 1000.00'],
    '13102025': ['TATAMOTORS 680.00'], // before the rename
    '14102025': ['TMPV 400.00'],
    '12112025': ['TMPV 410.00', 'TMCV 300.00'], // the demerged company lists a month later
  };
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    const notFound = { ok: false, status: 404, text: async () => '' };
    const h = url.match(/history\?index=equities&symbol=([^&]+)/);
    if (h) {
      const body = history[decodeURIComponent(h[1]!)];
      return body ? { ok: true, status: 200, text: async () => JSON.stringify(body) } : notFound;
    }
    const m = url.match(/sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/);
    if (m && closes[`${m[1]}${m[2]}${m[3]}`]) {
      const date = `${m[1]}-${MONTHS[Number(m[2]) - 1]}-${m[3]}`;
      const rows = closes[`${m[1]}${m[2]}${m[3]}`]!.map((x) => {
        const [sym, close] = x.split(' ');
        return `${sym}, EQ, ${date}, 1, 1, 1, 1, 1, ${close}, 1, 1, 1, 1, 1, 1`;
      });
      return { ok: true, status: 200, text: async () => [HEAD, ...rows].join('\n') };
    }
    return notFound;
  };
  return { urls, fetchText };
}

describe('past dividends and corporate-action history', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let nse: ReturnType<typeof fakeNse>;
  let surya: string;
  const holding = async (symbol: string, kind = 'stock') =>
    (
      await call('POST', '/api/holdings', {
        name: symbol,
        kind,
        symbol,
        currency: 'INR',
        ownerMemberId: surya,
      })
    ).json().data.id as string;
  const trade = (id: string, date: string, type: string, units: string | null, amount: number) =>
    call('POST', `/api/holdings/${id}/trades`, {
      date,
      type,
      ...(units && { units }),
      amount,
    });

  beforeEach(async () => {
    await resetDb();
    nse = fakeNse();
    app = await makeApp({
      fetchPrices: nse.fetchText,
      pricesUrl: 'http://nse.test/products/content',
      historyUrl: 'http://nse.test/history',
      nsePauseMs: 0,
    });
    call = client(app, (await signUp(app)).cookie);
    surya = (await call('GET', '/api/members')).json().data[0].id;
    const infy = await holding('INFY');
    await trade(infy, '2021-03-01', 'buy', '20', 2_600_000);
    await trade(infy, '2023-05-10', 'buy', '12', 1_740_000);
    // in today's units (the bonus doubled the 3 shares bought)
    const hdfc = await holding('HDFCBANK');
    await trade(hdfc, '2021-01-10', 'buy', '6', 900_000);
    await trade(hdfc, '2026-06-19', 'dividend', null, 7_800); // from Console: already there
    const sgb = await holding('SGBFEB32IV-GB', 'gold');
    await trade(sgb, '2024-02-21', 'buy', '8', 5_010_400);
    await trade(sgb, '2026-08-06', 'interest', null, 62_630);
    const sctl = await holding('SCTL');
    await trade(sctl, '2022-01-01', 'buy', '100', 10_000);
  });
  afterEach(() => app.close());

  const check = () => call('POST', '/api/holdings/dividend-check');

  it('works out each past dividend from the shares held then, and gold bond interest', async () => {
    const p = (await check()).json().data;
    expect(p.failed).toEqual(['SCTL']); // BSE only: no NSE history
    // (not the dividend from Console, nor the gold bond's latest interest: recorded already)
    expect(p).toMatchObject({ added: 6, amount: 33_000 + 4 * 62_630 + 6_600 });
    expect(p.rows).toEqual([
      // 20 shares × 16.50
      {
        symbol: 'INFY',
        date: '2021-10-21',
        units: 20,
        perShare: 16.5,
        amount: 33_000,
        kind: 'dividend',
      },
      // 8 bonds × 78.2875, every six months back to the purchase
      {
        symbol: 'SGBFEB32IV',
        date: '2024-08-06',
        units: 8,
        perShare: 78.2875,
        amount: 62_630,
        kind: 'interest',
      },
      {
        symbol: 'SGBFEB32IV',
        date: '2025-02-06',
        units: 8,
        perShare: 78.2875,
        amount: 62_630,
        kind: 'interest',
      },
      // 3 shares before the 1:1 bonus (6 today) × 22
      {
        symbol: 'HDFCBANK',
        date: '2025-06-27',
        units: 3,
        perShare: 22,
        amount: 6_600,
        kind: 'dividend',
      },
      {
        symbol: 'SGBFEB32IV',
        date: '2025-08-06',
        units: 8,
        perShare: 78.2875,
        amount: 62_630,
        kind: 'interest',
      },
      {
        symbol: 'SGBFEB32IV',
        date: '2026-02-06',
        units: 8,
        perShare: 78.2875,
        amount: 62_630,
        kind: 'interest',
      },
    ]);
    // again: everything is there; and the history is not asked again within a week
    const asked = nse.urls.filter((u) => u.includes('/history')).length;
    expect((await check()).json().data.added).toBe(0);
    expect(nse.urls.filter((u) => u.includes('/history')).length).toBe(asked + 1); // only SCTL again
    expect((await call('GET', '/api/holdings/dividend-check')).json().data).toEqual({
      checkedOn: todayLocal(),
      running: false,
      daily: false, // NSE prices are off for this family: no daily check, only on request
      available: true,
      failed: ['SCTL'],
      problem: null,
    });
  });

  it('checks each family with NSE prices once a day', async () => {
    const src = {
      fetch: nse.fetchText,
      historyUrl: 'http://nse.test/history',
      pricesUrl: 'http://nse.test/products/content',
      pauseMs: 0,
    };
    expect(await checkAllDividends(prisma, src)).toEqual({ added: 0 }); // NSE prices are off
    await prisma.family.updateMany({ data: { livePrices: true } });
    expect(await checkAllDividends(prisma, src)).toEqual({ added: 6 });
    expect(await checkAllDividends(prisma, src)).toEqual({ added: 0 }); // done for today
  });

  it('takes a dividend entered on its payment day, or after tax, as the same one', async () => {
    const infy = (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { symbol: string }) => h.symbol === 'INFY').id;
    // paid on 3 Nov for the 21 Oct ex-date, 10% TDS taken off
    await trade(infy, '2021-11-03', 'dividend', null, 29_700);
    const rows = (await check()).json().data.rows;
    expect(rows.filter((r: { symbol: string }) => r.symbol === 'INFY')).toEqual([]);
  });

  it('does not add a payout again once it was deleted', async () => {
    await check();
    const infy = (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { symbol: string }) => h.symbol === 'INFY');
    const paid = infy.trades.find((t: { type: string }) => t.type === 'dividend');
    await call('DELETE', `/api/holdings/${infy.id}/trades/${paid.id}`);
    expect((await check()).json().data.added).toBe(0);
  });

  it('adds nothing from a split left to check on, as the units then are not known', async () => {
    const hdfc = (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { symbol: string }) => h.symbol === 'HDFCBANK').id;
    await prisma.holdingAction.create({
      data: {
        holdingId: hdfc,
        exDate: new Date('2025-08-26'),
        purpose: 'Bonus 1:1',
        kind: 'bonus',
        status: 'review',
        unitsBefore: 6_000_000n,
        unitsAfter: 6_000_000n,
      },
    });
    const rows = (await check()).json().data.rows;
    // the one before it only
    expect(
      rows
        .filter((r: { symbol: string }) => r.symbol === 'HDFCBANK')
        .map((r: { date: string }) => r.date),
    ).toEqual(['2025-06-27']);
  });

  it('follows a running check with another when asked after a change', async () => {
    let open = () => {};
    let asked = () => {};
    const gate = new Promise<void>((r) => (open = r));
    const reading = new Promise<void>((r) => (asked = r));
    const slow: typeof nse.fetchText = async (url) => {
      asked(); // the holdings are read by now
      await gate;
      return nse.fetchText(url);
    };
    const src = {
      fetch: slow,
      historyUrl: 'http://nse.test/history',
      pricesUrl: 'http://nse.test/products/content',
      pauseMs: 0,
    };
    const familyId = (await prisma.family.findFirstOrThrow()).id;
    await prisma.holdingTrade.deleteMany({ where: { type: { not: 'buy' } } });
    const first = checkDividends(prisma, familyId, src);
    await reading;
    // a WIPRO bought while that check runs: the next one sees it
    const wipro = await holding('WIPRO');
    await trade(wipro, '2024-01-01', 'buy', '10', 400_000);
    const second = checkDividends(prisma, familyId, src, true);
    expect(checkDividends(prisma, familyId, src, true)).toBe(second); // one follow-up is enough
    open();
    await first;
    expect((await second).rows.map((r: { symbol: string }) => r.symbol)).toContain('WIPRO');
  });

  it('gives each person their own dividend, even the same amount on the same day', async () => {
    const appa = (await call('POST', '/api/members', { name: 'Appa' })).json().data.id;
    const theirs = (
      await call('POST', '/api/holdings', {
        name: 'INFY',
        kind: 'stock',
        symbol: 'INFY',
        currency: 'INR',
        ownerMemberId: appa,
      })
    ).json().data.id;
    await trade(theirs, '2021-03-01', 'buy', '20', 2_600_000);
    const rows = (await check())
      .json()
      .data.rows.filter((r: { date: string }) => r.date === '2021-10-21');
    expect(rows.map((r: { amount: number }) => r.amount)).toEqual([33_000, 33_000]);
  });

  it('lists the bonus with the shares and value before and after', async () => {
    await check();
    const events = (await call('GET', '/api/holdings/events')).json().data;
    expect(events).toEqual([
      {
        holdingId: expect.any(String),
        symbol: 'HDFCBANK',
        exDate: '2025-08-26',
        purpose: 'Bonus 1:1',
        kind: 'bonus',
        unitsBefore: 3,
        unitsAfter: 6,
        received: [],
        unlinked: false,
        valueBefore: 600_000, // 3 × 2,000
        valueAfter: 600_000, // 6 × 1,000
        change: 0,
      },
    ]);
  });

  it('follows the data: a bonus as its own lot, a renamed share, a demerger', async () => {
    // Paytm style: 60 bought, the bonus's 60 free shares as a lot of their own
    const wipro = await holding('WIPRO');
    await trade(wipro, '2021-02-26', 'buy', '60', 2_400_000);
    // (stored by a tradebook import; typed by hand a buy needs an amount)
    await prisma.holdingTrade.create({
      data: {
        holdingId: wipro,
        date: new Date('2024-12-03'),
        type: 'buy',
        units: 60_000_000,
        amount: 0,
      },
    });
    // Tata Motors (now TMPV), and the 78 TMCV received in its demerger
    const tmpv = await holding('TMPV');
    await trade(tmpv, '2024-01-10', 'buy', '78', 5_000_000);
    const tmcv = await holding('TMCV');
    await trade(tmcv, '2025-10-14', 'buy', '78', 2_067_234);
    const p = (await check()).json().data;
    // the dividend before the bonus on the 60 shares held then (not 30)
    expect(p.rows).toContainEqual(
      expect.objectContaining({ symbol: 'WIPRO', date: '2024-07-01', units: 60, amount: 6_000 }),
    );
    // Tata Motors' dividend, filed under its former symbol, is found for TMPV
    expect(p.rows).toContainEqual(
      expect.objectContaining({ symbol: 'TMPV', date: '2025-06-04', units: 78, amount: 46_800 }),
    );
    const events = (await call('GET', '/api/holdings/events')).json().data;
    expect(events.find((e: { symbol: string }) => e.symbol === 'WIPRO')).toMatchObject({
      unitsBefore: 60,
      unitsAfter: 120,
    });
    expect(events.find((e: { symbol: string }) => e.symbol === 'TMPV')).toMatchObject({
      unitsBefore: 78,
      unitsAfter: 78,
      received: [{ symbol: 'TMCV', units: 78, pricedOn: '2025-11-12' }],
      valueBefore: 5_304_000, // 78 × 680 (as TATAMOTORS)
      valueAfter: 5_460_000, // 78 × 400 + 78 × 300 (TMCV's first close)
      change: 156_000,
    });
  });

  it('counts a split worded twice (daily list and history) once, and never applies the history', async () => {
    const id = await holding('ADANIPOWER');
    await trade(id, '2021-01-04', 'buy', '75', 300_000); // in today's units
    // the daily list's row (upper case) and the history's (title case) for one split
    await prisma.corporateAction.create({
      data: {
        symbol: 'ADANIPOWER',
        exDate: new Date('2025-09-22'),
        purpose: 'FVSPLT FRM RS 10 TO RS 2',
        kind: 'split',
        num: 5,
        den: 1,
      },
    });
    await prisma.corporateAction.create({
      data: {
        symbol: 'ADANIPOWER',
        exDate: new Date('2025-09-22'),
        purpose: 'Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share',
        kind: 'split',
        num: 5,
        den: 1,
        source: 'history',
      },
    });
    await prisma.corporateAction.create({
      data: {
        symbol: 'ADANIPOWER',
        exDate: new Date('2025-06-10'),
        purpose: 'Dividend - Rs 2 Per Share',
        kind: 'dividend',
        amount: 2_000_000n,
        source: 'history',
      },
    });
    await prisma.fetchMark.createMany({
      data: [
        { name: 'nse-history:ADANIPOWER', day: new Date() },
        { name: 'nse-history-from:ADANIPOWER', day: new Date('2020-01-01') },
      ],
    });
    const p = (await check()).json().data;
    // 15 shares before the split (75 ÷ 5, not ÷ 25)
    expect(p.rows).toContainEqual(
      expect.objectContaining({ symbol: 'ADANIPOWER', units: 15, amount: 3_000 }),
    );
    const events = (await call('GET', '/api/holdings/events')).json().data;
    expect(events.filter((e: { symbol: string }) => e.symbol === 'ADANIPOWER')).toHaveLength(1);
  });

  it('works out gold bond interest from the series’ issue, with none recorded', async () => {
    const aug = await holding('SGBAUG28V-GB', 'gold');
    await trade(aug, '2025-06-01', 'buy', '2', 1_900_000);
    await trade(aug, '2026-03-01', 'buy', '1', 1_500_000);
    const rows = (await check())
      .json()
      .data.rows.filter((r: { symbol: string }) => r.symbol === 'SGBAUG28V');
    // 66.675 a bond (5,334 × 1.25%), 15 days before Feb 11 and Aug 11; rounded down
    expect(rows).toEqual([
      {
        symbol: 'SGBAUG28V',
        date: '2025-07-27',
        units: 2,
        perShare: 66.675,
        amount: 13_335,
        kind: 'interest',
      },
      {
        symbol: 'SGBAUG28V',
        date: '2026-01-27',
        units: 2,
        perShare: 66.675,
        amount: 13_335,
        kind: 'interest',
      },
      {
        symbol: 'SGBAUG28V',
        date: '2026-07-27',
        units: 3,
        perShare: 66.675,
        amount: 20_002,
        kind: 'interest',
      },
    ]);
  });

  it('says why when NSE refuses, and keeps gold bond interest paid a few days off', async () => {
    const refusing: typeof nse.fetchText = async (url) =>
      url.includes('/history')
        ? { ok: false, status: 403, text: async () => '' }
        : nse.fetchText(url);
    await app.close();
    app = await makeApp({
      fetchPrices: refusing,
      pricesUrl: 'http://nse.test/products/content',
      historyUrl: 'http://nse.test/history',
      nsePauseMs: 0,
    });
    call = client(app, (await signUp(app)).cookie);
    surya = (await call('GET', '/api/members')).json().data[0].id;
    const sgb = await holding('SGBFEB32IV-GB', 'gold');
    await trade(sgb, '2025-03-01', 'buy', '8', 5_010_400);
    await trade(sgb, '2025-08-08', 'interest', null, 62_630); // two days late
    await trade(sgb, '2026-02-06', 'interest', null, 62_630);
    const infy = await holding('INFY');
    await trade(infy, '2021-03-01', 'buy', '20', 2_600_000);
    const p = (await check()).json().data;
    expect(p.problem).toBe('NSE answered 403');
    expect(p.failed).toEqual(['INFY']);
    // 2025-08-06 is the one recorded on 2025-08-08; only the latest is left
    expect(p.rows.map((r: { date: string }) => r.date)).toEqual(['2026-08-06']);
  });
});

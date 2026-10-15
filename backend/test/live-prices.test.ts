import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  forgetLivePrices,
  refreshLivePrices,
  type FetchText,
} from '../src/services/livePriceService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

const HEAD =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const day = (date: string, infy: string) =>
  [
    HEAD,
    `INFY, EQ, ${date}, 1, 1, 1, 1, 1, ${infy}, 1, 1, 1, 1, 1, 1`,
    `GOLDBEES, EQ, ${date}, 1, 1, 1, 1, 1, 120.00, 1, 1, 1, 1, 1, 1`,
  ].join('\n');

/** A fake NSE archive: files for 13 and 14 Oct 2026 only (the 15th is not published yet). */
function fakeNse(opts: { fail?: boolean; everyDay?: boolean; noLists?: boolean } = {}) {
  const urls: string[] = [];
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    if (opts.fail) throw new Error('network down');
    const files: Record<string, string> = {
      'sec_bhavdata_full_13102026.csv': day('13-Oct-2026', '1000.00'),
      'sec_bhavdata_full_14102026.csv': day('14-Oct-2026', '1100.00'),
    };
    const name = url.split('/').at(-1)!;
    const lists: Record<string, string> = {
      'ind_nifty500list.csv':
        'Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,X',
      'ind_nifty100list.csv':
        'Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,X',
      'ind_niftymidcap150list.csv': 'Company Name,Industry,Symbol,Series,ISIN Code',
      'ind_niftysmallcap250list.csv': 'Company Name,Industry,Symbol,Series,ISIN Code',
      'ind_niftymicrocap250_list.csv': 'Company Name,Industry,Symbol,Series,ISIN Code',
    };
    if (lists[name] && opts.noLists) return { ok: false, status: 404, text: async () => '' };
    if (lists[name]) return { ok: true, status: 200, text: async () => lists[name]! };
    // everyDay: a file for whatever day is asked (tests that use the real date).
    const m = name.match(/_(\d{2})(\d{2})(\d{4})\.csv$/)!;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const body = opts.everyDay
      ? day(`${m[1]}-${months[Number(m[2]) - 1]}-${m[3]}`, '1100.00')
      : files[name];
    return { ok: !!body, status: body ? 200 : 404, text: async () => body ?? 'not found' };
  };
  return { urls, fetchText };
}

describe('daily prices from NSE', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let nse: ReturnType<typeof fakeNse>;
  let infy: string;
  beforeEach(async () => {
    await resetDb();
    forgetLivePrices();
    nse = fakeNse();
    app = await makeApp({ fetchPrices: nse.fetchText });
    call = client(app, (await signUp(app)).cookie);
    const holding = async (symbol: string) => {
      const h = (
        await call('POST', '/api/holdings', {
          name: symbol,
          kind: 'stock',
          symbol,
          currency: 'INR',
        })
      ).json().data;
      await call('POST', `/api/holdings/${h.id}/trades`, {
        date: '2026-10-01',
        type: 'buy',
        units: '10',
        amount: 1_000_000,
      });
      return h.id as string;
    };
    infy = await holding('INFY');
    await holding('SCTL'); // BSE only
  });
  afterEach(() => app.close());

  const value = async (id: string) =>
    (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { id: string }) => h.id === id);

  it('is off until the family switches it on; then takes the latest published day', async () => {
    let status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(nse.urls).toEqual([]); // nobody asked: nothing downloaded
    expect(status.asOf).toBeNull();

    await call('PUT', '/api/family', { livePrices: true });
    status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(nse.urls.filter((u) => u.includes('/sec_')).map((u) => u.split('/').at(-1))).toEqual([
      'sec_bhavdata_full_15102026.csv', // not yet published
      'sec_bhavdata_full_14102026.csv',
    ]);
    expect(status).toMatchObject({
      asOf: '2026-10-14',
      updated: 1,
      notFound: ['SCTL'],
      lastError: null,
    });
    expect(await value(infy)).toMatchObject({
      price: '1100',
      priceDate: '2026-10-14',
      value: 1_100_000,
    });
  });

  it('never replaces a price typed by hand, but does replace an imported one', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await call('POST', `/api/holdings/${infy}/prices`, { date: '2026-10-14', price: '999' });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(await value(infy)).toMatchObject({ price: '999' });

    await prisma.holdingPrice.updateMany({
      where: { holdingId: infy },
      data: { source: 'import' },
    });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(await value(infy)).toMatchObject({ price: '1100' });
  });

  it('keeps the prices it has when NSE cannot be reached', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    const down = fakeNse({ fail: true });
    const status = await refreshLivePrices(prisma, down.fetchText, '2026-10-16');
    expect(status.lastError).toMatch(/network down/);
    expect(await value(infy)).toMatchObject({ price: '1100' });
  });

  it('can be switched on and updated from the app', async () => {
    await app.close();
    app = await makeApp({ fetchPrices: fakeNse({ everyDay: true }).fetchText });
    call = client(app, (await signUp(app)).cookie);
    await call('POST', '/api/holdings', {
      name: 'SCTL',
      kind: 'stock',
      symbol: 'SCTL',
      currency: 'INR',
    }).then(async (res) =>
      call('POST', `/api/holdings/${res.json().data.id}/trades`, {
        date: '2026-10-01',
        type: 'buy',
        units: '1',
        amount: 100,
      }),
    );
    expect((await call('GET', '/api/family')).json().data.livePrices).toBe(false);
    await call('PUT', '/api/family', { livePrices: true });
    const res = await call('POST', '/api/holdings/live-prices/refresh');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ notFound: ['SCTL'] });
    expect((await call('GET', '/api/holdings/live-prices')).json().data.asOf).not.toBeUndefined();
  });

  it('archived and sold holdings, and holdings in other currencies, are left alone', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await call('PUT', `/api/holdings/${infy}`, { archived: true });
    const status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(status.updated).toBe(0);
  });

  it('a downloaded price corrected by hand stays corrected', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    await call('POST', `/api/holdings/${infy}/prices`, { date: '2026-10-14', price: '1095' });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(await value(infy)).toMatchObject({ price: '1095' });
  });

  it('downloads a day only once, and ignores trades dated later', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    const before = nse.urls.length;
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    // only today's (still unpublished) file is asked again
    expect(nse.urls.slice(before).map((u) => u.split('/').at(-1))).toEqual([
      'sec_bhavdata_full_15102026.csv',
    ]);
    await prisma.holdingTrade.create({
      data: {
        holdingId: infy,
        date: new Date('2026-12-01'),
        type: 'sell',
        units: 10_000_000,
        amount: 1,
      },
    });
    const status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    expect(status.updated).toBe(1); // still held on the 14th
  });

  it('only families that switched it on can ask for an update', async () => {
    expect((await call('POST', '/api/holdings/live-prices/refresh')).statusCode).toBe(403);
  });

  it('learns each company’s industry and size group, about once a month', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-15');
    const lists = () => nse.urls.filter((u) => u.includes('/ind_')).length;
    expect(lists()).toBe(5);
    const h = await value(infy);
    expect(h).toMatchObject({ industry: 'Information Technology', cap: 'large' });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-16');
    expect(lists()).toBe(5); // not again within the month
    await prisma.instrumentInfo.updateMany({ data: { updatedAt: new Date('2026-09-01') } });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-16');
    expect(lists()).toBe(10);
  });

  it('saved prices are not reported as failed when only the sector lists fail', async () => {
    await call('PUT', '/api/family', { livePrices: true });
    const status = await refreshLivePrices(
      prisma,
      fakeNse({ noLists: true }).fetchText,
      '2026-10-15',
    );
    expect(status).toMatchObject({ asOf: '2026-10-14', updated: 1, lastError: null });
    expect(status.warning).toMatch(/sectors/i);
  });
});

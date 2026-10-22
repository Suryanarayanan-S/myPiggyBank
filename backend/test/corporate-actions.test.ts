import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  forgetLivePrices,
  refreshLivePrices,
  type FetchText,
} from '../src/services/livePriceService.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';
import { makeZip } from './fixtures/zip.js';

const HEAD =
  'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BC_HEAD =
  'SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE';

/**
 * A fake NSE: a price file for every weekday (BUILDPRO 1300 until its 1:5 split on 8 Oct 2026,
 * 260 from then on; BHAGYANGR 400, demerged on 8 Oct) and the daily PR zip whose bc file lists
 * the split, the demerger and a dividend.
 */
function fakeNse(opts: { prStatus?: number; extra?: string[]; prMissing?: string[] } = {}) {
  const urls: string[] = [];
  const fetchText: FetchText = async (url) => {
    urls.push(url);
    const name = url.split('/').at(-1)!;
    const notFound = { ok: false, status: 404, text: async () => '' };
    if (url.includes('ibjarates') || url.includes('gold-api')) return notFound;
    const pr = name.match(/^PR(\d{2})(\d{2})(\d{2})\.zip$/);
    if (pr) {
      if (opts.prStatus) return { ok: false, status: opts.prStatus, text: async () => 'busy' };
      if (opts.prMissing?.includes(name)) return notFound;
      const bc = [
        BC_HEAD,
        'EQ,BUILDPRO,Shankara Buildpro Limited,2026-10-08,,,2026-10-08,,,FVSPLT FRM RS 10 TO RS 2',
        'BE,BUILDPRO,Shankara Buildpro Limited,2026-10-08,,,2026-10-08,,,FVSPLT FRM RS 10 TO RS 2',
        'EQ,BHAGYANGR,Bhagyanagar India Ltd,2026-10-08,,,2026-10-08,,,DEMERGER',
        'EQ,INFY,Infosys,2026-10-08,,,2026-10-08,,,INTERIM DIVIDEND - RS 23 PER SHARE',
        ...(opts.extra ?? []),
      ].join('\n');
      const zip = makeZip([
        { name: 'readme.txt', text: 'files' },
        { name: `bc${pr[1]}${pr[2]}20${pr[3]}.csv`, text: bc },
      ]);
      return {
        ok: true,
        status: 200,
        text: async () => zip.toString('latin1'),
        arrayBuffer: async () =>
          zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) as ArrayBuffer,
      };
    }
    const m = name.match(/^sec_bhavdata_full_(\d{2})(\d{2})(\d{4})\.csv$/);
    if (!m) return notFound;
    const day = `${m[3]}-${m[2]}-${m[1]}`;
    if (day > '2026-10-09' || [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()))
      return notFound;
    const date = `${m[1]}-${MONTHS[Number(m[2]) - 1]}-${m[3]}`;
    const row = (sym: string, close: string) =>
      `${sym}, EQ, ${date}, 1, 1, 1, 1, 1, ${close}, 1, 1, 1, 1, 1, 1`;
    const body = [
      HEAD,
      row('BUILDPRO', day < '2026-10-08' ? '1300.00' : '260.00'),
      row('BHAGYANGR', '400.00'),
      row('GOLDBEES', '120.00'),
    ].join('\n');
    return { ok: true, status: 200, text: async () => body };
  };
  return { urls, fetchText };
}

describe('splits and bonus issues from NSE', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let nse: ReturnType<typeof fakeNse>;
  /** As if entered before the split (the clock of the test is later). */
  const backdate = async (id: string, to = '2026-10-01') => {
    await prisma.holding.update({ where: { id }, data: { createdAt: new Date(to) } });
    await prisma.holdingTrade.updateMany({
      where: { holdingId: id },
      data: { createdAt: new Date(to) },
    });
  };
  const holding = async (
    symbol: string,
    buys: { date: string; units: string }[],
    entered = '2026-10-01',
  ) => {
    const h = (
      await call('POST', '/api/holdings', { name: symbol, kind: 'stock', symbol, currency: 'INR' })
    ).json().data;
    for (const b of buys)
      await call('POST', `/api/holdings/${h.id}/trades`, {
        date: b.date,
        type: 'buy',
        units: b.units,
        amount: 1_300_000,
      });
    await backdate(h.id, entered);
    return h.id as string;
  };
  const get = async (id: string) =>
    (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { id: string }) => h.id === id);

  beforeEach(async () => {
    await resetDb();
    forgetLivePrices();
    nse = fakeNse();
    app = await makeApp({ fetchPrices: nse.fetchText });
    call = client(app, (await signUp(app)).cookie);
    await call('PUT', '/api/family', { livePrices: true });
  });
  afterEach(() => app.close());

  it('applies a split on its ex-date: units × 5, earlier prices ÷ 5, money unchanged', async () => {
    const id = await holding('BUILDPRO', [{ date: '2026-10-01', units: '10' }]);
    const status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-08');
    expect(status.lastError).toBeNull();
    expect(status.warning ?? '').not.toMatch(/Splits/);
    const h = await get(id);
    expect(h).toMatchObject({ units: '50', avgCost: '260', price: '260', value: 1_300_000 });
    expect(h.trades).toMatchObject([{ units: '50', amount: 1_300_000 }]);
    // the closes filled in for earlier days (after the split was applied) are adjusted too
    expect(h.prices.map((p: { date: string; price: string }) => [p.date, p.price])).toEqual([
      ['2026-10-08', '260'],
      ['2026-10-07', '260'],
      ['2026-10-06', '260'],
      ['2026-10-05', '260'],
      ['2026-10-02', '260'],
      ['2026-10-01', '260'],
    ]);
    expect(h.actions).toEqual([
      {
        exDate: '2026-10-08',
        purpose: 'FVSPLT FRM RS 10 TO RS 2',
        kind: 'split',
        status: 'applied',
        unitsBefore: '10',
        unitsAfter: '50',
      },
    ]);

    // Later runs never apply it twice.
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    expect(await get(id)).toMatchObject({ units: '50', price: '260' });
    expect((await get(id)).actions).toHaveLength(1);
  });

  it('adjusts the prices already stored before the split', async () => {
    const id = await holding('BUILDPRO', [{ date: '2026-10-05', units: '10' }]);
    await call('POST', `/api/holdings/${id}/prices`, { date: '2026-10-06', price: '1310' });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-08');
    const prices = (await get(id)).prices.map((p: { date: string; price: string }) => [
      p.date,
      p.price,
    ]);
    expect(prices).toContainEqual(['2026-10-06', '262']);
  });

  it('asks the user to check instead when the holding was traded since, or for a demerger', async () => {
    // bought more on the ex-date: an import may already show the new units
    const traded = await holding('BUILDPRO', [
      { date: '2026-10-01', units: '10' },
      { date: '2026-10-08', units: '40' },
    ]);
    const demerged = await holding('BHAGYANGR', [{ date: '2026-10-01', units: '10' }]);
    // bought only after the ex-date: nothing to do
    const later = (
      await call('POST', '/api/holdings', {
        name: 'BUILDPRO 2',
        kind: 'stock',
        symbol: 'BUILDPRO',
        currency: 'INR',
      })
    ).json().data.id as string;
    await call('POST', `/api/holdings/${later}/trades`, {
      date: '2026-10-09',
      type: 'buy',
      units: '5',
      amount: 130_000,
    });
    await backdate(later);

    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    expect(await get(traded)).toMatchObject({ units: '50' });
    expect((await get(traded)).actions).toMatchObject([
      { kind: 'split', status: 'review', unitsBefore: '10', unitsAfter: '10' },
    ]);
    expect((await get(demerged)).actions).toMatchObject([
      { purpose: 'DEMERGER', kind: 'review', status: 'review' },
    ]);
    expect((await get(later)).actions).toEqual([]);
  });

  it('keeps the prices when the list cannot be had, and says so', async () => {
    nse = fakeNse({ prStatus: 503 });
    const id = await holding('BUILDPRO', [{ date: '2026-10-07', units: '10' }]);
    const status = await refreshLivePrices(prisma, nse.fetchText, '2026-10-08');
    expect(status.lastError).toBeNull();
    expect(status.warning).toMatch(/Splits and bonus issues not checked/);
    expect(await get(id)).toMatchObject({ units: '10', price: '260' });
  });

  it('remembers the actions it has stored, so a missed day is still applied later', async () => {
    const id = await holding('BUILDPRO', [{ date: '2026-10-01', units: '10' }]);
    // The day before the split, the list already names it (ex-dates up to a week ahead).
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-07');
    expect(await get(id)).toMatchObject({ units: '10' });
    expect(await prisma.corporateAction.count({ where: { symbol: 'BUILDPRO' } })).toBe(1);
    // The 8th's list fails, but the stored action is applied all the same.
    nse = fakeNse({ prStatus: 503 });
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-08');
    expect(await get(id)).toMatchObject({ units: '50' });
  });

  it('asks to check a holding entered after the ex-date (probably already in the new units)', async () => {
    // added on 15 Oct with a January buy of 50 — what the broker shows after the split
    const id = await holding('BUILDPRO', [{ date: '2026-01-10', units: '50' }], '2026-10-15');
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    expect(await get(id)).toMatchObject({ units: '50' });
    expect((await get(id)).actions).toMatchObject([{ status: 'review' }]);
  });

  it('never changes units twice: the same split worded differently is only checked', async () => {
    nse = fakeNse({
      extra: [
        'EQ,BUILDPRO,Shankara Buildpro Limited,2026-10-09,,,2026-10-09,,,FV SPLT FRM RS10 TO RS2',
      ],
    });
    const id = await holding('BUILDPRO', [{ date: '2026-10-01', units: '10' }]);
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    expect(await get(id)).toMatchObject({ units: '50' });
    expect((await get(id)).actions).toMatchObject([
      { exDate: '2026-10-09', status: 'review' },
      { exDate: '2026-10-08', status: 'applied' },
    ]);
  });

  it('catches up on the lists missed while the server was off, a few per run', async () => {
    await prisma.fetchMark.create({
      data: { name: 'nse-corporate-actions', day: new Date('2026-09-18T00:00:00Z') },
    });
    await holding('BUILDPRO', [{ date: '2026-09-01', units: '10' }]);
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    const lists = nse.urls.filter((u) => u.includes('/pr/')).map((u) => u.split('/').at(-1));
    // weekdays from the day after the last one read, oldest first, 10 per run
    expect(lists[0]).toBe('PR210926.zip');
    expect(lists).toHaveLength(10);
    const mark = await prisma.fetchMark.findUnique({ where: { name: 'nse-corporate-actions' } });
    expect(mark?.day.toISOString().slice(0, 10)).toBe('2026-10-02');
  });

  it("asks for the latest day's list again when it is not out yet", async () => {
    nse = fakeNse({ prMissing: ['PR091026.zip'] });
    await holding('BUILDPRO', [{ date: '2026-10-01', units: '10' }]);
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    let mark = await prisma.fetchMark.findUnique({ where: { name: 'nse-corporate-actions' } });
    expect(mark?.day.toISOString().slice(0, 10)).toBe('2026-10-08');
    nse = fakeNse();
    await refreshLivePrices(prisma, nse.fetchText, '2026-10-09');
    expect(nse.urls.filter((u) => u.includes('/pr/')).map((u) => u.split('/').at(-1))).toEqual([
      'PR091026.zip',
    ]);
    mark = await prisma.fetchMark.findUnique({ where: { name: 'nse-corporate-actions' } });
    expect(mark?.day.toISOString().slice(0, 10)).toBe('2026-10-09');
  });
});

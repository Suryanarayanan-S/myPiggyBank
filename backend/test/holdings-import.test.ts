import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayLocal } from '../src/lib/dates.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';
import { addDays } from '../src/lib/dates.js';

const HEAD =
  '"Instrument","Qty.","Avg. cost","LTP","Invested","Cur. val","P&L","Net chg.","Day chg.",""';
const file = (...lines: string[]) => Buffer.from([HEAD, ...lines].join('\n')).toString('base64');
const first = file(
  '"INFY",32,1361.19,1088.9,43558.2,34844.8,-8713.4,-20,2.51,""',
  '"GOLDBEES",5030,62.21,119.72,312899.59,602191.6,289292.01,92.46,-1.06,""',
  '"NATCO-RE",5,0,27.25,0,136.25,136.25,0,-7.19,""',
);

describe('importing broker holdings', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let surya: string;
  let appa: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app, { name: 'Surya' })).cookie);
    surya = (await call('GET', '/api/members')).json().data[0].id;
    appa = (await call('POST', '/api/members', { name: 'Appa' })).json().data.id;
  });
  afterEach(() => app.close());

  const preview = (data: string, ownerMemberId: string | null = surya) =>
    call('POST', '/api/holdings/import/preview', { fileName: 'holdings.csv', data, ownerMemberId });
  const commit = (data: string, extra: object = {}) =>
    call('POST', '/api/holdings/import/commit', {
      fileName: 'holdings.csv',
      data,
      ownerMemberId: surya,
      ...extra,
    });
  const holdings = async () =>
    (await call('GET', '/api/holdings')).json().data.holdings as {
      symbol: string;
      ownerMemberId: string | null;
      units: string;
      cost: number;
      value: number;
      kind: string;
      currency: string;
    }[];

  it('previews new holdings with their value', async () => {
    const res = await preview(first);
    expect(res.statusCode).toBe(200);
    const p = res.json().data;
    expect(p.currency).toBe('INR');
    expect(p.rows).toEqual([
      expect.objectContaining({ symbol: 'INFY', kind: 'stock', status: 'new', value: 3_484_480 }),
      expect.objectContaining({ symbol: 'GOLDBEES', kind: 'gold', status: 'new' }),
      expect.objectContaining({ symbol: 'NATCO-RE', status: 'new', invested: 0 }),
    ]);
    expect(p.totals).toEqual({ invested: 35_645_779, value: 63_717_265 });
  });

  it('creates the holdings for the chosen person, valued at the last price', async () => {
    const res = await commit(first);
    expect(res.json().data).toMatchObject({ created: 3, updated: 0, unchanged: 0 });
    const infy = (await holdings()).find((h) => h.symbol === 'INFY')!;
    expect(infy).toMatchObject({
      ownerMemberId: surya,
      currency: 'INR',
      units: '32',
      cost: 4_355_820,
      value: 3_484_480,
    });
  });

  it('a later export updates quantities and prices instead of adding duplicates', async () => {
    await commit(first);
    const later = file(
      '"INFY",40,1300,1100,52000,44000,0,0,0,""', // bought 8 more
      '"GOLDBEES",5000,62.21,120,311033.23,600000,0,0,0,""', // sold 30
      '"NATCO-RE",5,0,30,0,150,0,0,0,""', // only the price moved
    );
    const p = (await preview(later)).json().data;
    expect(p.rows.map((r: { status: string }) => r.status)).toEqual(['more', 'less', 'same']);
    expect((await commit(later)).json().data).toMatchObject({ created: 0, updated: 3 });
    const all = await holdings();
    expect(all).toHaveLength(3);
    expect(all.find((h) => h.symbol === 'INFY')).toMatchObject({ units: '40', value: 4_400_000 });
    expect(all.find((h) => h.symbol === 'GOLDBEES')).toMatchObject({ units: '5000' });
    expect(all.find((h) => h.symbol === 'NATCO-RE')).toMatchObject({ value: 15_000 });
  });

  it('keeps each person’s demat apart, and lists holdings missing from the file', async () => {
    await commit(first);
    const p = (await preview(file('"INFY",1,100,1100,100,1100,0,0,0,""'), appa)).json().data;
    expect(p.rows[0].status).toBe('new'); // Appa's INFY is not Surya's
    const mine = (await preview(file('"INFY",32,1361.19,1088.9,43558.2,0,0,0,0,""'))).json().data;
    expect(mine.missing.map((m: { symbol: string }) => m.symbol).sort()).toEqual([
      'GOLDBEES',
      'NATCO-RE',
    ]);
  });

  it('can stop counting the manual asset the holdings replace, keeping its history', async () => {
    const asset = (
      await call('POST', '/api/assets', {
        name: 'Zerotha Surya',
        assetClass: 'investment',
        currency: 'INR',
        value: 120_000_000,
        date: '2026-10-08',
      })
    ).json().data;
    const p = (await preview(first)).json().data;
    expect(p.assets).toEqual([
      expect.objectContaining({ id: asset.id, name: 'Zerotha Surya', suggested: true }),
    ]);
    await commit(first, { retireAssetId: asset.id });
    const after = (await call('GET', '/api/assets'))
      .json()
      .data.find((a: { id: string }) => a.id === asset.id);
    expect(after).toMatchObject({ value: 0, valuedAt: todayLocal() });
    expect(after.history).toHaveLength(2);
  });

  it('sells fewer units at the file’s price; the same file twice changes nothing', async () => {
    await commit(first);
    const fewer = file(
      '"INFY",30,1361.19,1100,40835.7,33000,0,0,0,""',
      '"GOLDBEES",5030,62.21,119.72,312899.59,602191.6,0,0,0,""',
      '"NATCO-RE",5,0,27.25,0,136.25,0,0,0,""',
    );
    expect((await commit(fewer)).json().data).toMatchObject({ updated: 1, unchanged: 2 });
    expect((await commit(fewer)).json().data).toMatchObject({ updated: 0, unchanged: 3 });
    const infy = (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.find((h: { symbol: string }) => h.symbol === 'INFY');
    expect(infy.units).toBe('30');
    expect(infy.trades[0]).toMatchObject({ type: 'sell', units: '2', amount: 220_000 });
  });

  it('can mark holdings missing from the file as sold', async () => {
    await commit(first);
    const onlyInfy = file('"INFY",32,1361.19,1088.9,43558.2,34844.8,0,0,0,""');
    await commit(onlyInfy, { sellMissing: true });
    const all = (await call('GET', '/api/holdings')).json().data.holdings;
    expect(all.find((h: { symbol: string }) => h.symbol === 'GOLDBEES').units).toBe('0');
    expect((await preview(onlyInfy)).json().data.missing).toEqual([]);
  });

  it('matches exchange-style symbols and warns about the same symbol held by someone else', async () => {
    await call('POST', '/api/holdings', {
      name: 'Infosys',
      kind: 'stock',
      symbol: 'NSE:INFY',
      currency: 'INR',
      ownerMemberId: surya,
    });
    const gold = (
      await call('POST', '/api/holdings', {
        name: 'Gold ETF',
        kind: 'gold',
        symbol: 'GOLDBEES.NS',
        currency: 'INR',
        ownerMemberId: appa,
      })
    ).json().data;
    await call('POST', `/api/holdings/${gold.id}/trades`, {
      date: '2026-01-05',
      type: 'buy',
      units: '10',
      amount: 60_000,
    });
    const p = (await preview(first)).json().data;
    expect(p.rows[0]).toMatchObject({ symbol: 'INFY', status: 'more', alsoHeldBy: [] });
    expect(p.rows[1]).toMatchObject({ symbol: 'GOLDBEES', status: 'new', alsoHeldBy: ['Appa'] });
    await commit(first);
    const infys = (await call('GET', '/api/holdings'))
      .json()
      .data.holdings.filter(
        (h: { name: string; symbol: string }) => h.name === 'Infosys' || h.symbol === 'INFY',
      );
    expect(infys).toHaveLength(1);
  });

  it('only an investment asset in rupees can be retired', async () => {
    const house = (
      await call('POST', '/api/assets', {
        name: 'House',
        assetClass: 'property',
        currency: 'INR',
        value: 800_000_000,
      })
    ).json().data;
    const res = await commit(first, { retireAssetId: house.id });
    expect(res.statusCode).toBe(400);
    expect((await call('GET', '/api/holdings')).json().data.holdings).toHaveLength(0);
  });

  it('a shared demat is matched as shared', async () => {
    await commit(first, { ownerMemberId: null });
    const p = (await preview(first, null)).json().data;
    expect(p.rows.every((r: { status: string }) => r.status === 'same')).toBe(true);
  });

  it('refuses files that are not holdings exports, and other families’ members', async () => {
    const bank = Buffer.from('Date;Amount\n01.10.2026;5').toString('base64');
    const res = await preview(bank);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Zerodha/);
    const other = client(app, (await signUp(app)).cookie);
    const theirs = (await other('GET', '/api/members')).json().data[0].id;
    expect((await preview(first, theirs)).statusCode).toBe(404);
  });

  it('right after a split, a file still showing the old units is no sale', async () => {
    await commit(first);
    // A 1:5 split two days ago, applied (32 → 160); the broker credits the new shares later.
    const infy = await prisma.holding.findFirstOrThrow({ where: { symbol: 'INFY' } });
    await prisma.holdingTrade.updateMany({
      where: { holdingId: infy.id },
      data: { units: 160_000_000n },
    });
    await prisma.holdingAction.create({
      data: {
        holdingId: infy.id,
        exDate: new Date(`${addDays(todayLocal(), -2)}T00:00:00Z`),
        purpose: 'FVSPLT FRM RS 10 TO RS 2',
        kind: 'split',
        status: 'applied',
        num: 5,
        den: 1,
        unitsBefore: 32_000_000n,
        unitsAfter: 160_000_000n,
      },
    });
    const p = (await preview(first)).json().data;
    expect(p.rows[0]).toMatchObject({ symbol: 'INFY', status: 'same' });
    await commit(first);
    expect((await holdings()).find((h) => h.symbol === 'INFY')).toMatchObject({ units: '160' });
    const trades = await prisma.holdingTrade.findMany({ where: { holdingId: infy.id } });
    expect(trades.filter((t) => t.type === 'sell')).toHaveLength(0);
  });

  describe('dividend and interest reports (Console)', () => {
    const report = (head: string, ...lines: string[]) =>
      Buffer.from([head, ...lines].join('\n')).toString('base64');
    const dividends = report(
      'Symbol,Ex-date,Qty,Dividend per share,Total dividend',
      'INFY#,2025-10-27,26,23,598',
      'HDBFS,2025-10-24,20,2,40', // sold since: not among the holdings
      'INFY#,2026-06-10,30,25,750',
    );
    const interest = report(
      'Symbol,Ex-date,Qty,Interest per share,Total interest',
      'SGBFEB32IV,2026-02-06,8,78.2875,626.3',
    );
    const income = (kind: 'preview' | 'commit', data: string) =>
      call('POST', `/api/holdings/income/${kind}`, {
        fileName: 'dividends.csv',
        data,
        ownerMemberId: surya,
      });

    it('previews, records each payout once, and puts payouts of sold shares on archived holdings', async () => {
      await commit(first);
      const p = (await income('preview', dividends)).json().data;
      expect(p).toMatchObject({
        kind: 'dividend',
        total: 138_800,
        toAdd: { count: 3, amount: 138_800 },
        newHoldings: ['HDBFS'],
      });
      expect(p.rows[1]).toMatchObject({ symbol: 'HDBFS', held: false, status: 'new' });

      expect((await income('commit', dividends)).json().data).toMatchObject({
        added: 3,
        skipped: 0,
        newHoldings: ['HDBFS'],
      });
      // again: nothing new
      expect((await income('commit', dividends)).json().data).toMatchObject({
        added: 0,
        skipped: 3,
      });
      const data = (await call('GET', '/api/holdings')).json().data;
      const infy = data.holdings.find((h: { symbol: string }) => h.symbol === 'INFY');
      expect(infy.dividends).toBe(134_800);
      const hdbfs = data.holdings.find((h: { symbol: string }) => h.symbol === 'HDBFS');
      expect(hdbfs).toMatchObject({ archived: true, dividends: 4_000, ownerMemberId: surya });
      // the year's dividends add up, the sold share's included
      expect(data.summary.dividends).toBe(138_800);
    });

    it('records gold bond interest as interest', async () => {
      await income('commit', interest);
      const sgb = (await call('GET', '/api/holdings')).json().data.holdings[0];
      expect(sgb).toMatchObject({ symbol: 'SGBFEB32IV', kind: 'gold', dividends: 62_630 });
      expect(sgb.trades).toMatchObject([{ type: 'interest', date: '2026-02-06', amount: 62_630 }]);
    });

    it('takes gold bond interest recorded a few days off as the same coupon', async () => {
      // worked out from the series' dates on Feb 6; Console has two coupons, one moved by a holiday
      await income('commit', interest);
      const sgb = (await call('GET', '/api/holdings')).json().data.holdings[0];
      await call('POST', `/api/holdings/${sgb.id}/trades`, {
        date: '2025-08-06',
        type: 'interest',
        amount: 62_630,
      });
      const p = (
        await income(
          'preview',
          report(
            'Symbol,Ex-date,Qty,Interest per share,Total interest',
            'SGBFEB32IV,2025-08-08,8,78.2875,626.3',
            'SGBFEB32IV,2026-02-06,8,78.2875,626.3',
            'SGBFEB32IV,2026-08-06,8,78.2875,626.3',
          ),
        )
      ).json().data;
      expect(p.rows.map((r: { status: string }) => r.status)).toEqual(['recorded', 'recorded', 'new']);
    });

    it('matches Kite symbols written with their market (PGINVIT-IV, SGBFEB32IV-GB)', async () => {
      await commit(
        file(
          '"PGINVIT-IV",50,100,103.84,5000,5192,192,3.84,0,""',
          '"SGBFEB32IV-GB",8,5000,15411.53,40000,123292.24,83292.24,208.23,0,""',
        ),
      );
      const p = (
        await income(
          'preview',
          report(
            'Symbol,Ex-date,Qty,Dividend per share,Total dividend',
            'PGINVIT,2026-02-12,50,3,150',
          ),
        )
      ).json().data;
      expect(p.newHoldings).toEqual([]);
      expect((await income('preview', interest)).json().data.newHoldings).toEqual([]);
    });

    it('never records a payout twice, even once the sold share is bought again', async () => {
      await commit(first);
      await income('commit', dividends); // HDBFS goes on an archived holding
      // bought again, as a new holding
      const h = (
        await call('POST', '/api/holdings', {
          name: 'HDB Financial',
          kind: 'stock',
          symbol: 'HDBFS',
          currency: 'INR',
          ownerMemberId: surya,
        })
      ).json().data;
      expect(h.id).toBeDefined();
      expect((await income('commit', dividends)).json().data).toMatchObject({ added: 0 });
      // two equal payouts on one day (e.g. two lots) are both kept
      const twice = report(
        'Symbol,Ex-date,Qty,Dividend per share,Total dividend',
        'INFY,2026-09-01,10,5,50',
        'INFY,2026-09-01,10,5,50',
      );
      expect((await income('commit', twice)).json().data).toMatchObject({ added: 2 });
      expect((await income('commit', twice)).json().data).toMatchObject({ added: 0 });
    });

    it('warns when the shares belong to someone else in the family', async () => {
      await commit(first, { ownerMemberId: appa });
      const p = (await income('preview', dividends)).json().data;
      expect(p.heldByOthers).toEqual(['Appa']);
    });

    it('reads a report with a title line above its header, and stray spaces', async () => {
      const p = (
        await income(
          'preview',
          report(
            'Dividend report for AB1234',
            'Symbol,Ex-date,Qty,Dividend per share,Total dividend',
            '"INFY# ",2025-10-27,26,23,598',
          ),
        )
      ).json().data;
      expect(p.rows).toMatchObject([{ symbol: 'INFY', amount: 59_800 }]);
    });

    it('refuses a file that is not such a report', async () => {
      expect((await income('preview', first)).statusCode).toBe(400);
    });
  });

  describe('tradebook (Console)', () => {
    const HEAD =
      'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time';
    const book = (...lines: string[]) =>
      Buffer.from([HEAD, ...lines].join('\n')).toString('base64');
    const tradebook = (kind: 'preview' | 'commit', data: string) =>
      call('POST', `/api/holdings/tradebook/${kind}`, {
        fileName: 'tradebook.csv',
        data,
        ownerMemberId: surya,
      });
    // INFY 32 held (the holdings file), bought in three lots; GOLDBEES does not add up;
    // ADANIPORTS bought and sold; VISESH never in the holdings
    const file = book(
      'INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,20,1300,1,1,x',
      'INFY,X,2023-05-10,NSE,EQ,EQ,buy,false,20,1400,2,2,x',
      'INFY,X,2024-01-15,NSE,EQ,EQ,sell,false,8,1500,3,3,x',
      'GOLDBEES,X,2022-01-01,NSE,EQ,EQ,buy,false,10,45,4,4,x',
      'ADANIPORTS,X,2021-03-03,NSE,EQ,EQ,buy,false,10,745.83,5,5,x',
      'ADANIPORTS,X,2021-03-19,NSE,EQ,EQ,sell,false,10,682.04,6,6,x',
      'VISESHINFO,X,2021-06-01,NSE,EQ,EQ,buy,false,1090,0.5,7,7,x',
    );

    it('gives the holdings their real trades where the file adds up, and lists the rest', async () => {
      await commit(first);
      const p = (await tradebook('preview', file)).json().data;
      expect(p).toMatchObject({
        trades: 7,
        from: '2021-03-01',
        to: '2024-01-15',
        notInFile: ['NATCO-RE'],
      });
      expect(
        Object.fromEntries(
          p.symbols.map((s: { symbol: string; action: string }) => [s.symbol, s.action]),
        ),
      ).toEqual({
        INFY: 'replace',
        ADANIPORTS: 'history',
        GOLDBEES: 'mismatch',
        VISESHINFO: 'not-held',
      });
      expect((await tradebook('commit', file)).json().data).toEqual({
        replaced: 1,
        history: 1,
        skipped: 2,
      });

      const list = (await call('GET', '/api/holdings')).json().data.holdings as {
        symbol: string;
        units: string;
        archived: boolean;
        realised: number;
        trades: { date: string; type: string }[];
      }[];
      const infy = list.find((h) => h.symbol === 'INFY')!;
      expect(infy.units).toBe('32');
      expect(infy.trades.map((t) => [t.date, t.type])).toEqual([
        ['2024-01-15', 'sell'],
        ['2023-05-10', 'buy'],
        ['2021-03-01', 'buy'],
      ]);
      const ports = list.find((h) => h.symbol === 'ADANIPORTS')!;
      expect(ports).toMatchObject({ archived: true, units: '0', realised: -63_790 }); // 10 × (682.04 − 745.83);
      // GOLDBEES as it was (one entry from the holdings file)
      expect(list.find((h) => h.symbol === 'GOLDBEES')!.trades).toHaveLength(1);
    });

    it('keeps dividends when the trades are replaced, and can be imported again', async () => {
      await commit(first);
      await call('POST', '/api/holdings/income/commit', {
        fileName: 'd.csv',
        data: Buffer.from(
          'Symbol,Ex-date,Qty,Dividend per share,Total dividend\nINFY,2025-10-27,26,23,598',
        ).toString('base64'),
        ownerMemberId: surya,
      });
      await tradebook('commit', file);
      await tradebook('commit', file);
      const infy = (await call('GET', '/api/holdings'))
        .json()
        .data.holdings.find((h: { symbol: string }) => h.symbol === 'INFY');
      expect(infy.units).toBe('32');
      expect(infy.dividends).toBe(59_800);
      expect(infy.trades).toHaveLength(4);
      // the sold one is not added twice
      const ports = (await call('GET', '/api/holdings'))
        .json()
        .data.holdings.filter((h: { symbol: string }) => h.symbol === 'ADANIPORTS');
      expect(ports).toHaveLength(1);
    });

    it('accepts a sell before its buy on the same day; leaves two holdings of one symbol alone', async () => {
      await commit(first);
      const p = (
        await tradebook(
          'preview',
          book(
            'INFY,X,2021-03-01,NSE,EQ,EQ,sell,false,5,1300,1,1,x',
            'INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,37,1300,2,2,x',
          ),
        )
      ).json().data;
      expect(p.symbols[0]).toMatchObject({ symbol: 'INFY', action: 'replace' });
      // a second INFY holding (e.g. an old one, archived)
      await call('POST', '/api/holdings', {
        name: 'INFY old',
        kind: 'stock',
        symbol: 'INFY',
        currency: 'INR',
        ownerMemberId: surya,
        archived: true,
      });
      const q = (
        await tradebook('preview', book('INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,32,1300,2,2,x'))
      ).json().data;
      expect(q.symbols[0]).toMatchObject({ symbol: 'INFY', action: 'several' });
      // an impossible day is an error, not a crash
      const r = (
        await tradebook('preview', book('INFY,X,2024-02-30,NSE,EQ,EQ,buy,false,1,1,2,2,x'))
      ).json().data;
      expect(r.errors).toHaveLength(1);
    });

    it('leaves out a symbol that sells more than it buys, and refuses another file', async () => {
      await commit(first);
      const p = (
        await tradebook('preview', book('INFY,X,2021-03-01,NSE,EQ,EQ,sell,false,5,1300,1,1,x'))
      ).json().data;
      expect(p.symbols[0]).toMatchObject({ symbol: 'INFY', action: 'oversold' });
      expect((await tradebook('preview', first)).statusCode).toBe(400);
    });
  });
});

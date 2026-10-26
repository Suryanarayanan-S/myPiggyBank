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
        added: 0,
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
      const held = (await call('GET', '/api/holdings')).json().data.holdings;
      const infyId = held.find((h: { symbol: string }) => h.symbol === 'INFY').id;
      await call('POST', `/api/holdings/${infyId}/trades`, {
        date: '2025-10-27',
        type: 'dividend',
        amount: 59_800,
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
      // and the other way round: a tradebook given as the holdings file says what it is
      const wrong = await preview(book('INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,5,1300,1,1,x'));
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.message).toMatch(/This is a tradebook/);
    });
  });
  describe('demat accounts', () => {
    const HEAD =
      'symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time';
    const book = (...lines: string[]) =>
      Buffer.from([HEAD, ...lines].join('\n')).toString('base64');
    const demat = async (name: string, ownerMemberId: string | null, type = 'investment') =>
      (await call('POST', '/api/accounts', { name, type, currency: 'INR', ownerMemberId })).json()
        .data.id as string;
    const all = async () =>
      (await call('GET', '/api/holdings')).json().data.holdings as {
        symbol: string;
        ownerMemberId: string | null;
        accountId: string | null;
        units: string;
        archived: boolean;
      }[];

    it("imports into a demat account: its owner's holdings, kept in it", async () => {
      const zerodha = await demat('Zerodha · OYM940', appa);
      // the account decides whose they are, whatever person is sent
      const r = await commit(first, { ownerMemberId: surya, accountId: zerodha });
      expect(r.json().data).toMatchObject({ created: 3 });
      expect((await all()).every((h) => h.ownerMemberId === appa && h.accountId === zerodha)).toBe(
        true,
      );
      // the tradebook into the same demat finds them; sold shares land in it too
      const tb = book(
        'INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,32,1300,1,1,x',
        'ADANIPORTS,X,2021-03-03,NSE,EQ,EQ,buy,false,10,745.83,5,5,x',
        'ADANIPORTS,X,2021-03-19,NSE,EQ,EQ,sell,false,10,682.04,6,6,x',
      );
      const res = await call('POST', '/api/holdings/tradebook/commit', {
        fileName: 'tradebook.csv',
        data: tb,
        ownerMemberId: null,
        accountId: zerodha,
      });
      expect(res.json().data).toMatchObject({ replaced: 1, history: 1 });
      const ports = (await all()).find((h) => h.symbol === 'ADANIPORTS')!;
      expect(ports).toMatchObject({ ownerMemberId: appa, accountId: zerodha, archived: true });
    });

    it("moves a person's holdings without a demat into the first one imported", async () => {
      await commit(first);
      const zerodha = await demat('Zerodha · XVH685', surya);
      await call('POST', '/api/holdings/tradebook/commit', {
        fileName: 'tradebook.csv',
        data: book('INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,32,1300,1,1,x'),
        ownerMemberId: surya,
        accountId: zerodha,
      });
      expect((await all()).find((h) => h.symbol === 'INFY')!.accountId).toBe(zerodha);
      // a holdings file into the demat updates them (nothing created twice)
      const r = await commit(first, { accountId: zerodha });
      expect(r.json().data).toMatchObject({ created: 0 });
      expect((await all()).every((h) => h.accountId === zerodha)).toBe(true);
    });

    it('keeps two demats of one person apart', async () => {
      const one = await demat('Zerodha', surya);
      const two = await demat('Groww', surya);
      await commit(first, { accountId: one });
      const r = await commit(first, { accountId: two });
      expect(r.json().data).toMatchObject({ created: 3 });
      const infy = (await all()).filter((h) => h.symbol === 'INFY');
      expect(infy.map((h) => h.accountId).sort()).toEqual([one, two].sort());
    });

    it("moves a person's holdings outside a demat into theirs, archived ones too", async () => {
      // the demat first (it takes nothing yet), then holdings imported outside it
      const zerodha = await demat('Zerodha · XVH685', surya);
      await commit(first);
      await commit(first, { ownerMemberId: appa });
      const old = await call('POST', '/api/holdings', {
        name: 'OLD',
        kind: 'stock',
        symbol: 'OLD',
        currency: 'INR',
        ownerMemberId: surya,
        archived: true,
      });
      expect(old.statusCode).toBe(201);
      const move = (body: object) => call('POST', '/api/holdings/move-to-demat', body);
      const usd = await call('POST', '/api/holdings', {
        name: 'AAPL',
        kind: 'stock',
        symbol: 'AAPL',
        currency: 'USD',
        ownerMemberId: surya,
      });
      expect(usd.statusCode).toBe(201);
      const r = await move({ accountId: zerodha });
      expect(r.json().data).toEqual({ moved: 4 });
      const list = await all();
      expect(list.filter((h) => h.accountId === zerodha)).toHaveLength(4);
      // Appa's stay where they were; dollar shares are not in an Indian demat
      expect(list.filter((h) => h.ownerMemberId === appa).every((h) => !h.accountId)).toBe(true);
      expect(list.find((h) => h.symbol === 'AAPL')!.accountId).toBeNull();
    });

    it('lets the demat decide whose its holdings are', async () => {
      const zerodha = await demat('Zerodha · OYM940', appa);
      await commit(first, { accountId: zerodha });
      const infy = (await all()).find((h) => h.symbol === 'INFY') as unknown as { id: string };
      // a holding in it entered for someone else stays the demat owner's
      await call('PUT', `/api/holdings/${infy.id}`, { ownerMemberId: surya });
      expect((await all()).find((h) => h.symbol === 'INFY')!.ownerMemberId).toBe(appa);
      // the demat given to another person: its holdings follow, and imports still find them
      await call('PUT', `/api/accounts/${zerodha}`, { ownerMemberId: surya });
      expect((await all()).every((h) => h.ownerMemberId === surya)).toBe(true);
      const r = await commit(first, { accountId: zerodha });
      expect(r.json().data).toMatchObject({ created: 0 });
      expect(await all()).toHaveLength(3);
    });

    it("without a demat touches only the person's holdings outside one", async () => {
      const zerodha = await demat('Zerodha', surya);
      await commit(first, { accountId: zerodha });
      const r = await commit(file('"INFY",5,1000,1000,5000,5000,0,0,0,""'), {
        sellMissing: true,
      });
      expect(r.json().data).toMatchObject({ created: 1, sold: 0 });
      const infy = (await all()).filter((h) => h.symbol === 'INFY');
      expect(infy.map((h) => [h.accountId, h.units]).sort()).toEqual(
        [
          [zerodha, '32'],
          [null, '5'],
        ].sort(),
      );
    });

    it("treats a closed demat's holdings as in none: a new demat takes them", async () => {
      const old = await demat('Upstox', surya);
      await commit(first, { accountId: old });
      await call('PUT', `/api/accounts/${old}`, { archived: true });
      const zerodha = await demat('Zerodha', surya);
      const r = await commit(first, { accountId: zerodha });
      expect(r.json().data).toMatchObject({ created: 0 });
      expect((await all()).every((h) => h.accountId === zerodha)).toBe(true);
    });

    it('adds the holdings a tradebook holds but the demat does not, when asked', async () => {
      const zerodha = await demat('Zerodha · OYM940', appa);
      const tb = book(
        'GOLDBEES,X,2024-01-11,NSE,EQ,EQ,buy,false,2,52.86,1,1,x',
        'GOLDBEES,X,2024-02-19,NSE,EQ,EQ,buy,false,927,52.69,2,2,x',
        'GOLD1,X,2024-01-09,NSE,EQ,EQ,buy,false,2,53.13,3,3,x',
      );
      const body = { fileName: 'tradebook.csv', data: tb, ownerMemberId: null, accountId: zerodha };
      const p = (await call('POST', '/api/holdings/tradebook/preview', body)).json().data;
      // a demat with nothing in it yet: adding them is the obvious choice
      expect(p.fresh).toBe(true);
      expect(p.symbols.map((s: { action: string }) => s.action)).toEqual(['not-held', 'not-held']);
      // not asked: left out
      expect(
        (await call('POST', '/api/holdings/tradebook/commit', body)).json().data,
      ).toMatchObject({ added: 0, skipped: 2 });
      const r = await call('POST', '/api/holdings/tradebook/commit', { ...body, addMissing: true });
      expect(r.json().data).toMatchObject({ added: 2, skipped: 0 });
      const list = await all();
      expect(
        list.map((h) => [h.symbol, h.units, h.ownerMemberId, h.accountId, h.archived]),
      ).toEqual(
        expect.arrayContaining([
          ['GOLDBEES', '929', appa, zerodha, false],
          ['GOLD1', '2', appa, zerodha, false],
        ]),
      );
      // again: they are held now, so their trades are simply used again
      const again = await call('POST', '/api/holdings/tradebook/commit', {
        ...body,
        addMissing: true,
      });
      expect(again.json().data).toMatchObject({ replaced: 2, added: 0 });
      expect(await all()).toHaveLength(2);
      const q = (await call('POST', '/api/holdings/tradebook/preview', body)).json().data;
      expect(q.fresh).toBe(false);
    });

    it('never adds a symbol the person holds in another demat', async () => {
      const zerodha = await demat('Zerodha', surya);
      const groww = await demat('Groww', surya);
      await commit(first, { accountId: zerodha });
      const body = {
        fileName: 'tradebook.csv',
        data: book(
          'INFY,X,2021-03-01,NSE,EQ,EQ,buy,false,5,1300,1,1,x',
          'TCS,X,2021-03-01,NSE,EQ,EQ,buy,false,2,3000,2,2,x',
        ),
        ownerMemberId: null,
        accountId: groww,
      };
      const p = (await call('POST', '/api/holdings/tradebook/preview', body)).json().data;
      expect(p.fresh).toBe(false);
      expect(
        Object.fromEntries(
          p.symbols.map((s: { symbol: string; action: string }) => [s.symbol, s.action]),
        ),
      ).toEqual({ INFY: 'elsewhere', TCS: 'not-held' });
      const r = await call('POST', '/api/holdings/tradebook/commit', { ...body, addMissing: true });
      expect(r.json().data).toMatchObject({ added: 1, skipped: 1 });
      expect((await all()).filter((h) => h.symbol === 'INFY')).toHaveLength(1);
    });

    it("gives a person's first demat their holdings in none; a second starts empty", async () => {
      await commit(first);
      await commit(first, { ownerMemberId: appa });
      // a euro broker first: not a demat, it takes nothing and does not count as the first
      await call('POST', '/api/accounts', {
        name: 'Trade Republic',
        type: 'investment',
        currency: 'EUR',
        ownerMemberId: surya,
      });
      expect((await all()).every((h) => !h.accountId)).toBe(true);
      const zerodha = await demat('Zerodha', surya);
      let list = await all();
      expect(
        list.filter((h) => h.ownerMemberId === surya).every((h) => h.accountId === zerodha),
      ).toBe(true);
      // Appa's are his: not moved
      expect(list.filter((h) => h.ownerMemberId === appa).every((h) => !h.accountId)).toBe(true);
      // a second demat of Surya's takes nothing (a holding added outside stays outside)
      await call('POST', '/api/holdings', {
        name: 'TCS',
        kind: 'stock',
        symbol: 'TCS',
        currency: 'INR',
        ownerMemberId: surya,
      });
      await demat('Groww', surya);
      list = await all();
      expect(list.find((h) => h.symbol === 'TCS')!.accountId).toBeNull();
      expect(list.filter((h) => h.accountId === zerodha)).toHaveLength(3);
    });

    it('takes only an investment account of the family', async () => {
      const bank = await demat('ICICI', surya, 'savings');
      const res = await commit(first, { accountId: bank });
      expect(res.statusCode).toBe(400);
      const missing = await commit(first, { accountId: '00000000-0000-4000-8000-000000000000' });
      expect(missing.statusCode).toBe(404);
    });
  });
});

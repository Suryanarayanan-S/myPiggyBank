import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayLocal } from '../src/lib/dates.js';
import { client, makeApp, resetDb, signUp } from './helpers.js';

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
});

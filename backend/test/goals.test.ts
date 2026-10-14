import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { client, makeApp, resetDb, signUp } from './helpers.js';

const today = todayLocal();
const thisMonth = today.slice(0, 7);
/** The same day next year (exactly 12 months away). */
const inAYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

async function family(app: FastifyInstance) {
  const call = client(app, (await signUp(app)).cookie);
  const tagesgeld = (
    await call('POST', '/api/accounts', {
      name: 'Tagesgeld',
      type: 'tagesgeld',
      currency: 'EUR',
      openingBalance: 200_000,
    })
  ).json().data;
  const gold = (
    await call('POST', '/api/assets', {
      name: 'Gold',
      assetClass: 'other',
      currency: 'INR',
      value: 5_000_000, // ₹50,000
      date: addDays(today, -200),
    })
  ).json().data;
  return { call, tagesgeld, gold };
}

describe('savings goals', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof family>>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await family(app);
  });
  afterEach(() => app.close());

  const create = (body: object) =>
    f.call('POST', '/api/goals', {
      name: 'House deposit',
      targetAmount: 1_000_000,
      currency: 'EUR',
      ...body,
    });
  const list = async () => (await f.call('GET', '/api/goals')).json().data;

  it('counts linked account balances and manual entries towards the target', async () => {
    const res = await create({ links: [{ kind: 'account', id: f.tagesgeld.id }] });
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id;
    await f.call('POST', `/api/goals/${id}/entries`, { date: today, amount: 50_000, note: 'Cash' });
    const [goal] = await list();
    expect(goal).toMatchObject({
      name: 'House deposit',
      saved: 250_000,
      unconverted: [],
      progress: { pctBp: 2500, left: 750_000, onTrack: null },
      links: [
        {
          kind: 'account',
          id: f.tagesgeld.id,
          name: 'Tagesgeld',
          amount: 200_000,
          currency: 'EUR',
        },
      ],
    });
    expect(goal.entries).toEqual([
      { id: expect.any(String), date: today, amount: 50_000, note: 'Cash' },
    ]);
  });

  it('converts a linked INR asset, or lists it when there is no rate', async () => {
    await create({ links: [{ kind: 'asset', id: f.gold.id }] });
    expect((await list())[0]).toMatchObject({
      saved: 0,
      unconverted: [{ currency: 'INR', amount: 5_000_000 }],
    });
    await f.call('PUT', '/api/exchange-rates', {
      month: thisMonth,
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    expect((await list())[0]).toMatchObject({ saved: 50_000, unconverted: [] });
  });

  it('works out the monthly amount needed and the pace from the last 3 months', async () => {
    const cats: { id: string; name: string }[] = (await f.call('GET', '/api/categories')).json()
      .data;
    await f.call('POST', '/api/transactions', {
      date: addDays(today, -10),
      amount: 300_000,
      type: 'income',
      accountId: f.tagesgeld.id,
      categoryId: cats.find((c) => c.name === 'Interest')!.id,
    });
    await create({
      links: [{ kind: 'account', id: f.tagesgeld.id }],
      targetDate: inAYear,
    });
    const { progress } = (await list())[0];
    expect(progress.pace).toBe(100_000); // +€3,000 within 3 months
    expect(progress.monthsLeft).toBe(12);
    expect(progress.monthlyNeeded).toBe(Math.ceil((1_000_000 - 500_000) / 12));
    expect(progress.onTrack).toBe(true);
  });

  it('allows withdrawals as negative entries and deletes entries', async () => {
    const id = (await create({})).json().data.id;
    const e = (
      await f.call('POST', `/api/goals/${id}/entries`, { date: today, amount: -10_000 })
    ).json().data;
    expect((await list())[0].saved).toBe(-10_000);
    const del = await f.call('DELETE', `/api/goals/${id}/entries/${e.entries[0].id}`);
    expect(del.statusCode).toBe(200);
    expect((await list())[0].saved).toBe(0);
  });

  it('replaces links on update and can mark a goal reached', async () => {
    const id = (await create({ links: [{ kind: 'account', id: f.tagesgeld.id }] })).json().data.id;
    const res = await f.call('PUT', `/api/goals/${id}`, {
      links: [{ kind: 'asset', id: f.gold.id }],
      status: 'reached',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'reached', links: [{ kind: 'asset' }] });
  });

  it('keeps working when a linked account is deleted', async () => {
    const empty = (
      await f.call('POST', '/api/accounts', { name: 'Old', type: 'savings', currency: 'EUR' })
    ).json().data;
    await create({ links: [{ kind: 'account', id: empty.id }] });
    await f.call('DELETE', `/api/accounts/${empty.id}`);
    expect((await list())[0]).toMatchObject({ saved: 0, links: [] });
  });

  it.each([
    [{ targetAmount: 0 }],
    [{ currency: 'XYZ' }],
    [{ name: '' }],
    [{ targetDate: '2026-02-30' }],
    [{ links: [{ kind: 'house', id: '00000000-0000-4000-8000-000000000000' }] }],
  ])('rejects invalid input %#', async (body) => {
    expect((await create(body)).statusCode).toBe(400);
  });

  it('keeps goals and links inside the family', async () => {
    const other = await family(app);
    expect(
      (await create({ links: [{ kind: 'account', id: other.tagesgeld.id }] })).statusCode,
    ).toBe(404);
    const id = (await create({})).json().data.id;
    expect((await other.call('GET', '/api/goals')).json().data).toEqual([]);
    expect((await other.call('PUT', `/api/goals/${id}`, { name: 'Mine' })).statusCode).toBe(404);
    expect((await other.call('DELETE', `/api/goals/${id}`)).statusCode).toBe(404);
    expect(
      (await other.call('POST', `/api/goals/${id}/entries`, { date: today, amount: 1 })).statusCode,
    ).toBe(404);
    expect((await f.call('DELETE', `/api/goals/${id}`)).statusCode).toBe(200);
    expect(await list()).toEqual([]);
  });

  it('does not invent progress from a rate that exists only for this month', async () => {
    await f.call('PUT', '/api/exchange-rates', {
      month: thisMonth,
      base: 'EUR',
      quote: 'INR',
      rate: '100',
    });
    await create({ links: [{ kind: 'asset', id: f.gold.id }], targetDate: inAYear });
    const g = (await list())[0];
    expect(g.saved).toBe(50_000);
    expect(g.progress.pace).toBe(0); // the gold did not change
  });

  it('does not count an asset entered today as saved in the last 3 months', async () => {
    const car = (
      await f.call('POST', '/api/assets', {
        name: 'Car fund',
        assetClass: 'other',
        currency: 'EUR',
        value: 300_000,
        date: today,
      })
    ).json().data;
    await create({ links: [{ kind: 'asset', id: car.id }], targetDate: inAYear });
    const g = (await list())[0];
    expect(g.progress.pace).toBe(0);
    expect(g.progress.onTrack).toBe(false);
  });

  it('refuses to change the currency once there are entries (no 1:1 re-reading)', async () => {
    const id = (await create({})).json().data.id;
    expect((await f.call('PUT', `/api/goals/${id}`, { currency: 'INR' })).statusCode).toBe(200);
    await f.call('POST', `/api/goals/${id}/entries`, { date: today, amount: 100 });
    const res = await f.call('PUT', `/api/goals/${id}`, { currency: 'EUR' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CURRENCY_LOCKED');
  });

  it('refuses entries dated in the future', async () => {
    const id = (await create({})).json().data.id;
    const res = await f.call('POST', `/api/goals/${id}/entries`, {
      date: addDays(today, 30),
      amount: 5_000,
    });
    expect(res.statusCode).toBe(400);
  });
});

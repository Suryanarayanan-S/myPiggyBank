import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayLocal } from '../src/lib/dates.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('physical gold', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  const today = todayLocal();
  const necklace = (extra: object = {}) => ({
    name: 'Wedding necklace',
    grams: '10',
    purity: '22k',
    boughtOn: '2020-11-14',
    boughtFor: 4_500_000, // ₹45,000
    ...extra,
  });
  // IBJA's 999 rate, as the daily download stores it (₹ per gram, in micros)
  const rate = (date: string, rupees: number) =>
    prisma.benchmarkPoint.create({
      data: { series: 'gold24k', date: new Date(`${date}T00:00:00Z`), value: rupees * 1_000_000 },
    });

  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    await call('PUT', '/api/family', { wealthCurrency: 'INR' });
  });
  afterEach(() => app.close());

  it('is valued from the latest IBJA rate by its weight and purity', async () => {
    await rate('2026-10-19', 14_000);
    await rate('2026-10-21', 14_410.5);
    expect((await call('POST', '/api/gold', necklace())).statusCode).toBe(201);
    const data = (await call('GET', '/api/gold')).json().data;
    expect(data.rate).toMatchObject({ date: '2026-10-21', perGram24k: 14_410.5 });
    expect(data.items[0]).toMatchObject({
      name: 'Wedding necklace',
      grams: '10',
      purity: '22k',
      value: 13_200_018, // 10 g × 14,410.50 × 0.916
      boughtFor: 4_500_000,
      gain: 13_200_018 - 4_500_000,
      status: 'held',
    });
    expect(data.summary).toMatchObject({ currency: 'INR', value: 13_200_018, grams: '10' });
  });

  it('has no value without a rate, and says so', async () => {
    await call('POST', '/api/gold', necklace({ boughtFor: null }));
    const data = (await call('GET', '/api/gold')).json().data;
    expect(data.rate).toBeNull();
    expect(data.items[0].value).toBeNull();
  });

  it('counts in net worth until it is no longer held', async () => {
    await rate(today, 14_410.5);
    const id = (await call('POST', '/api/gold', necklace())).json().data.id;
    const worth = async () => (await call('GET', '/api/net-worth')).json().data.current.assets;
    expect(await worth()).toBe(13_200_018);
    // counted at what was paid, when the family chooses so (the value if not known)
    await call('PUT', '/api/family', { investmentsAt: 'invested' });
    expect(await worth()).toBe(4_500_000);
    await call('PUT', '/api/family', { investmentsAt: 'value' });
    await call('PUT', `/api/gold/${id}`, { closedAt: today });
    expect(await worth()).toBe(0);
    expect((await call('GET', '/api/gold')).json().data.items[0].status).toBe('closed');
  });

  it('can be part of a goal', async () => {
    await rate(today, 14_410.5);
    const id = (await call('POST', '/api/gold', necklace())).json().data.id;
    const res = await call('POST', '/api/goals', {
      name: 'Daughter’s wedding',
      targetAmount: 100_000_000,
      currency: 'INR',
      links: [{ kind: 'gold', id }],
    });
    expect(res.statusCode).toBe(201);
    expect((await call('GET', '/api/goals')).json().data[0].saved).toBe(13_200_018);
  });

  it('refuses what does not make sense, and keeps each family’s gold to itself', async () => {
    const bad = async (body: object) =>
      (await call('POST', '/api/gold', necklace(body))).statusCode;
    expect(await bad({ grams: '0' })).toBe(400);
    expect(await bad({ purity: '20k' })).toBe(400);
    expect(await bad({ boughtFor: -1 })).toBe(400);
    const id = (await call('POST', '/api/gold', necklace())).json().data.id;
    expect((await call('PUT', `/api/gold/${id}`, { closedAt: '2019-01-01' })).statusCode).toBe(400);
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('GET', '/api/gold')).json().data.items).toEqual([]);
    expect((await other('DELETE', `/api/gold/${id}`)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/gold/${id}`)).statusCode).toBe(200);
  });

  it('counts gold held before the first rate at that first rate, not as nothing', async () => {
    // rates only since today (the daily download was switched on today)
    await rate(today, 14_410.5);
    const id = (await call('POST', '/api/gold', necklace())).json().data.id;
    await call('POST', '/api/goals', {
      name: 'Wedding',
      targetAmount: 100_000_000,
      currency: 'INR',
      links: [{ kind: 'gold', id }],
    });
    const goal = (await call('GET', '/api/goals')).json().data[0];
    // three months ago it was worth the same: nothing "saved" in the last three months
    expect(goal.saved).toBe(13_200_018);
    expect(goal.progress.pace).toBe(0);
  });

  it('says when the rate is out of date', async () => {
    await rate('2026-01-02', 12_000);
    await call('POST', '/api/gold', necklace());
    expect((await call('GET', '/api/gold')).json().data.rate).toMatchObject({
      date: '2026-01-02',
      stale: true,
    });
  });

  it('records gold already gone in one go; no future purchase dates', async () => {
    const res = await call('POST', '/api/gold', necklace({ closedAt: '2024-05-01' }));
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ status: 'closed', closedAt: '2024-05-01' });
    expect((await call('POST', '/api/gold', necklace({ closedAt: '2019-05-01' }))).statusCode).toBe(
      400,
    );
    expect((await call('POST', '/api/gold', necklace({ boughtOn: '2099-01-01' }))).statusCode).toBe(
      400,
    );
  });
});

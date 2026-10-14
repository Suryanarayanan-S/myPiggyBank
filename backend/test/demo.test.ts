import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEMO, seedDemo } from '../src/demo/seedDemo.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('demo data', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
  });
  afterEach(() => app.close());

  const loginDemo = async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: DEMO.email, password: DEMO.password },
    });
    expect(res.statusCode).toBe(200);
    const s = res.cookies.find((c) => c.name === 'pb_session')!;
    return client(app, `pb_session=${s.value}`);
  };

  it('creates a clearly labelled family with a year of data you can log in to', async () => {
    await seedDemo(prisma, { today: '2026-10-14' });
    const call = await loginDemo();
    const me = (await call('GET', '/api/auth/me')).json().data;
    expect(me.family.name).toMatch(/demo/i);

    const budget = (await call('GET', '/api/budget/2026-09')).json().data;
    expect(budget.netIncome).toBeGreaterThan(0);
    expect(budget.essentials).toBeGreaterThan(0);
    expect(budget.unconverted).toEqual([]); // every INR amount has a rate

    const dash = (await call('GET', '/api/dashboard?from=2025-11&to=2026-10')).json().data;
    expect(dash.months.filter((m: { netIncome: number }) => m.netIncome > 0)).toHaveLength(12);

    const nw = (await call('GET', '/api/net-worth')).json().data;
    expect(nw.current.unconverted).toEqual([]);
    expect(nw.current.liabilities).toBeGreaterThan(0);
    expect(nw.snapshots.length).toBeGreaterThanOrEqual(12);

    // Nothing in the future.
    const late = await prisma.transaction.count({
      where: { date: { gt: new Date('2026-10-14') }, recurringRuleId: null },
    });
    expect(late).toBe(0);
  });

  it('refuses to run twice unless asked to reset, and never touches other families', async () => {
    const other = client(app, (await signUp(app, { name: 'Real' })).cookie);
    await other('POST', '/api/accounts', { name: 'Mine', type: 'current', currency: 'EUR' });

    await seedDemo(prisma, { today: '2026-10-14' });
    await expect(seedDemo(prisma, { today: '2026-10-14' })).rejects.toThrow(/already exists/);
    await seedDemo(prisma, { today: '2026-10-14', reset: true });

    expect(await prisma.family.count()).toBe(2);
    expect((await other('GET', '/api/accounts')).json().data).toHaveLength(1);
    await loginDemo();
  });
});

describe('demo reset', { timeout: 60_000 }, () => {
  it('refuses to delete a real family that happens to use the demo email', async () => {
    await resetDb();
    const app = await makeApp();
    await signUp(app, { email: DEMO.email, name: 'Someone real' });
    await expect(seedDemo(prisma, { today: '2026-10-14', reset: true })).rejects.toThrow(
      /not the demo family/,
    );
    expect(await prisma.family.count()).toBe(1);
    await app.close();
  });
});

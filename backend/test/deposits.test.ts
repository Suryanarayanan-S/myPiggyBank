import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { client, makeApp, resetDb, signUp } from './helpers.js';

describe('fixed deposits', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let savings: string;
  const today = todayLocal();
  // ₹1,00,000 at 7 % for a year, compounded quarterly; started 3 months and 30 days ago
  const fd = (extra: object = {}) => ({
    name: 'HDFC FD',
    currency: 'INR',
    principal: 10_000_000,
    rateBp: 700,
    startDate: '2026-01-15',
    maturityDate: '2027-01-15',
    compounding: 'quarterly',
    interest: 'reinvest',
    ...extra,
  });

  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app)).cookie);
    await call('PUT', '/api/family', { wealthCurrency: 'INR' });
    savings = (
      await call('POST', '/api/accounts', {
        name: 'HDFC Savings',
        type: 'savings',
        currency: 'INR',
        openingBalance: 0,
      })
    ).json().data.id;
  });
  afterEach(() => app.close());

  it('creates a deposit linked to an account and values it from its terms', async () => {
    const res = await call('POST', '/api/deposits', fd({ accountId: savings }));
    expect(res.statusCode).toBe(201);
    const list = (await call('GET', '/api/deposits')).json().data;
    expect(list.deposits).toHaveLength(1);
    expect(list.deposits[0]).toMatchObject({
      name: 'HDFC FD',
      kind: 'fd',
      accountId: savings,
      principal: 10_000_000,
      maturityAmount: 10_718_590,
      startDate: '2026-01-15',
      maturityDate: '2027-01-15',
    });
    const d = list.deposits[0];
    expect(d.value).toBeGreaterThan(10_000_000);
    expect(d.interestEarned).toBe(d.value - 10_000_000);
    expect(list.summary).toMatchObject({ currency: 'INR', principal: 10_000_000, value: d.value });
  });

  it('counts in net worth as an investment until paid out', async () => {
    const id = (await call('POST', '/api/deposits', fd())).json().data.id;
    const worth = async () => (await call('GET', '/api/net-worth')).json().data.current;
    const value = (await call('GET', '/api/deposits')).json().data.deposits[0].value;
    expect((await worth()).assets).toBe(value);

    // Counting investments at what was put in: the principal.
    await call('PUT', '/api/family', { investmentsAt: 'invested' });
    expect((await worth()).assets).toBe(10_000_000);

    // Paid out: no longer counted, kept in the list as closed.
    await call('PUT', `/api/deposits/${id}`, { closedAt: today });
    expect((await worth()).assets).toBe(0);
    expect((await call('GET', '/api/deposits')).json().data.deposits[0]).toMatchObject({
      status: 'closed',
      closedAt: today,
    });
  });

  it('says when it matures, and what it pays out', async () => {
    await call(
      'POST',
      '/api/deposits',
      fd({ startDate: addDays(today, -300), maturityDate: addDays(today, 65), interest: 'payout' }),
    );
    const d = (await call('GET', '/api/deposits')).json().data.deposits[0];
    expect(d).toMatchObject({
      status: 'active',
      daysLeft: 65,
      value: 10_000_000,
      maturityAmount: 10_000_000,
      payoutPerPeriod: 175_000,
    });
  });

  it('refuses what does not make sense', async () => {
    const bad = async (body: object) => (await call('POST', '/api/deposits', fd(body))).statusCode;
    expect(await bad({ maturityDate: '2026-01-15' })).toBe(400); // not after the start
    expect(await bad({ rateBp: 0 })).toBe(400);
    expect(await bad({ principal: -5 })).toBe(400);
    expect(await bad({ compounding: 'daily' })).toBe(400);
    // the account holds another currency
    const eur = (
      await call('POST', '/api/accounts', {
        name: 'Sparkasse',
        type: 'savings',
        currency: 'EUR',
        openingBalance: 0,
      })
    ).json().data.id;
    expect(await bad({ accountId: eur })).toBe(400);
    const id = (await call('POST', '/api/deposits', fd())).json().data.id;
    expect((await call('PUT', `/api/deposits/${id}`, { closedAt: '2025-12-31' })).statusCode).toBe(
      400,
    ); // closed before it started
    // …also when only the start moves past the paid-out day
    await call('PUT', `/api/deposits/${id}`, { closedAt: '2026-06-30' });
    expect(
      (
        await call('PUT', `/api/deposits/${id}`, {
          startDate: '2026-09-01',
          maturityDate: '2027-09-01',
        })
      ).statusCode,
    ).toBe(400);
    // an account with deposits keeps its currency
    expect(
      (await call('PUT', `/api/deposits/${id}`, { closedAt: null, accountId: savings })).statusCode,
    ).toBe(200);
    expect((await call('PUT', `/api/accounts/${savings}`, { currency: 'EUR' })).statusCode).toBe(
      400,
    );
  });

  it('keeps each family’s deposits to itself', async () => {
    const id = (await call('POST', '/api/deposits', fd())).json().data.id;
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('GET', '/api/deposits')).json().data.deposits).toEqual([]);
    expect((await other('PUT', `/api/deposits/${id}`, { name: 'x' })).statusCode).toBe(404);
    expect((await other('DELETE', `/api/deposits/${id}`)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/deposits/${id}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/deposits')).json().data.deposits).toEqual([]);
  });

  it('can be part of a goal', async () => {
    const id = (await call('POST', '/api/deposits', fd())).json().data.id;
    const value = (await call('GET', '/api/deposits')).json().data.deposits[0].value;
    const res = await call('POST', '/api/goals', {
      name: 'House',
      targetAmount: 50_000_000,
      currency: 'INR',
      links: [{ kind: 'deposit', id }],
    });
    expect(res.statusCode).toBe(201);
    const goal = (await call('GET', '/api/goals')).json().data[0];
    expect(goal.links).toMatchObject([{ kind: 'deposit', id, name: 'HDFC FD', amount: value }]);
    expect(goal.saved).toBe(value);
  });
});

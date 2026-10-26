import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, resetDb, signUp } from './helpers.js';

describe('accounts', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    call = client(app, (await signUp(app, { name: 'Surya' })).cookie);
  });
  afterEach(() => app.close());

  const sparkasse = {
    name: 'Sparkasse',
    type: 'current',
    currency: 'EUR',
    openingBalance: 100_000,
  };

  it('creates an account whose balance starts at the opening balance', async () => {
    const res = await call('POST', '/api/accounts', sparkasse);
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toEqual({
      id: expect.any(String),
      ...sparkasse,
      ownerMemberId: null,
      assetClass: 'liquid',
      archived: false,
      balance: 100_000,
      monthChange: 0,
    });
    const list = await call('GET', '/api/accounts');
    expect(list.json().data).toHaveLength(1);
  });

  it('defaults investment accounts to the investment asset class', async () => {
    const res = await call('POST', '/api/accounts', {
      name: 'Zerodha',
      type: 'investment',
      currency: 'INR',
    });
    expect(res.json().data).toMatchObject({ assetClass: 'investment', openingBalance: 0 });
  });

  it.each([
    [{ ...sparkasse, type: 'piggy' }],
    [{ ...sparkasse, currency: 'JPY' }],
    [{ ...sparkasse, openingBalance: 1.5 }],
    [{ ...sparkasse, name: '  ' }],
    [{ ...sparkasse, assetClass: 'crypto' }],
  ])('rejects invalid input %#', async (payload) => {
    const res = await call('POST', '/api/accounts', payload);
    expect(res.statusCode).toBe(400);
  });

  it('assigns an owner from the family, but not from another family', async () => {
    const [me] = (await call('GET', '/api/members')).json().data;
    const owned = await call('POST', '/api/accounts', { ...sparkasse, ownerMemberId: me.id });
    expect(owned.json().data.ownerMemberId).toBe(me.id);

    const other = client(app, (await signUp(app, { name: 'Mallory' })).cookie);
    const res = await other('POST', '/api/accounts', { ...sparkasse, ownerMemberId: me.id });
    expect(res.statusCode).toBe(404);
  });

  it('rejects duplicate names case-insensitively', async () => {
    await call('POST', '/api/accounts', sparkasse);
    const dup = await call('POST', '/api/accounts', { ...sparkasse, name: 'SPARKASSE' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ACCOUNT_EXISTS');
  });

  it('allows one name for different people (each their own Zerodha), never twice for one', async () => {
    const [me] = (await call('GET', '/api/members')).json().data;
    const appa = (await call('POST', '/api/members', { name: 'Appa' })).json().data;
    const zerodha = { name: 'Zerodha', type: 'investment', currency: 'INR' };
    const mine = await call('POST', '/api/accounts', { ...zerodha, ownerMemberId: me.id });
    expect(mine.statusCode).toBe(201);
    const his = await call('POST', '/api/accounts', { ...zerodha, ownerMemberId: appa.id });
    expect(his.statusCode).toBe(201);
    const shared = await call('POST', '/api/accounts', zerodha);
    expect(shared.statusCode).toBe(201);
    // the same person twice: refused, also when an owner changes onto a name taken
    expect(
      (await call('POST', '/api/accounts', { ...zerodha, ownerMemberId: appa.id })).statusCode,
    ).toBe(409);
    expect((await call('POST', '/api/accounts', zerodha)).statusCode).toBe(409);
    const moved = await call('PUT', `/api/accounts/${his.json().data.id}`, {
      ownerMemberId: me.id,
    });
    expect(moved.statusCode).toBe(409);
    expect(
      (await call('PUT', `/api/accounts/${his.json().data.id}`, { ownerMemberId: null }))
        .statusCode,
    ).toBe(409);
    // a deleted member leaves two shared "Zerodha"s: each can still be edited
    await call('DELETE', `/api/members/${appa.id}`);
    const edit = await call('PUT', `/api/accounts/${his.json().data.id}`, {
      name: 'Zerodha',
      archived: true,
    });
    expect(edit.statusCode).toBe(200);
  });

  it('updates and archives an account, then deletes it', async () => {
    const id = (await call('POST', '/api/accounts', sparkasse)).json().data.id;
    const res = await call('PUT', `/api/accounts/${id}`, {
      name: 'Sparkasse Giro',
      archived: true,
    });
    expect(res.json().data).toMatchObject({ name: 'Sparkasse Giro', archived: true });
    expect((await call('DELETE', `/api/accounts/${id}`)).statusCode).toBe(200);
    expect((await call('GET', '/api/accounts')).json().data).toEqual([]);
  });

  it("isolates families: another family cannot see, edit or delete this family's accounts", async () => {
    const id = (await call('POST', '/api/accounts', sparkasse)).json().data.id;
    const other = client(app, (await signUp(app, { name: 'Mallory' })).cookie);
    expect((await other('GET', '/api/accounts')).json().data).toEqual([]);
    expect((await other('PUT', `/api/accounts/${id}`, { name: 'Hacked' })).statusCode).toBe(404);
    expect((await other('DELETE', `/api/accounts/${id}`)).statusCode).toBe(404);
    expect((await call('GET', '/api/accounts')).json().data[0].name).toBe('Sparkasse');
  });

  it('handles crore-sized INR amounts beyond 32-bit integers', async () => {
    const res = await call('POST', '/api/accounts', {
      name: 'Property fund',
      type: 'investment',
      currency: 'INR',
      openingBalance: 30_000_000_000, // ₹30 Cr in paise
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.balance).toBe(30_000_000_000);
    const txn = await call('POST', '/api/transactions', {
      date: '2026-10-01',
      amount: 2_500_000_000,
      type: 'income',
      accountId: res.json().data.id,
    });
    expect(txn.statusCode).toBe(201);
    expect(txn.json().data.amount).toBe(2_500_000_000);
    const list = (await call('GET', '/api/accounts')).json().data;
    expect(list[0].balance).toBe(32_500_000_000);
  });
});

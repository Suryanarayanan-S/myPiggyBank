import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('delete my account', () => {
  let app: FastifyInstance;
  let s: Awaited<ReturnType<typeof signUp>>;
  let call: ReturnType<typeof client>;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    s = await signUp(app, { name: 'Surya' });
    call = client(app, s.cookie);
    const acc = (
      await call('POST', '/api/accounts', { name: 'Sparkasse', type: 'current', currency: 'EUR' })
    ).json().data;
    await call('POST', '/api/members', { name: 'Spouse' });
    await call('POST', '/api/transactions', {
      date: '2026-10-01',
      amount: 100,
      type: 'income',
      accountId: acc.id,
    });
  });
  afterEach(() => app.close());

  const del = (body: object, c = call) => c('DELETE', '/api/auth/account', body);
  const familyRows = async (familyId: string) => ({
    families: await prisma.family.count({ where: { id: familyId } }),
    users: await prisma.user.count({ where: { familyId } }),
    members: await prisma.familyMember.count({ where: { familyId } }),
    accounts: await prisma.account.count({ where: { familyId } }),
    categories: await prisma.category.count({ where: { familyId } }),
    transactions: await prisma.transaction.count({ where: { familyId } }),
  });

  it('refuses with a wrong password and deletes nothing', async () => {
    const res = await del({ password: 'wrong-password', confirm: 'DELETE' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect((await familyRows(s.user.familyId)).transactions).toBe(1);
  });

  it('requires typing DELETE to confirm', async () => {
    const res = await del({ password: s.payload.password, confirm: 'delete' });
    expect(res.statusCode).toBe(400);
    expect((await familyRows(s.user.familyId)).families).toBe(1);
  });

  it("as the family's only login, deletes the family and all its data", async () => {
    const other = await signUp(app, { name: 'Neighbour' });
    const res = await del({ password: s.payload.password, confirm: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ok: true, familyDeleted: true });
    expect(res.cookies.find((c) => c.name === 'pb_session')?.value).toBe('');

    expect(await familyRows(s.user.familyId)).toEqual({
      families: 0,
      users: 0,
      members: 0,
      accounts: 0,
      categories: 0,
      transactions: 0,
    });
    expect(await prisma.session.count({ where: { userId: s.user.id } })).toBe(0);
    expect((await call('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await familyRows(other.user.familyId)).families).toBe(1);

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: s.payload,
    });
    expect(again.statusCode).toBe(201);
  });

  it('when other logins share the family, removes only this login', async () => {
    const second = await prisma.user.create({
      data: {
        familyId: s.user.familyId,
        email: 'spouse@example.com',
        passwordHash: 'x',
        name: 'Spouse',
        role: 'member',
      },
    });
    const res = await del({ password: s.payload.password, confirm: 'DELETE' });
    expect(res.json().data).toEqual({ ok: true, familyDeleted: false });
    expect(await prisma.user.count({ where: { id: s.user.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: second.id } })).toBe(1);
    const rows = await familyRows(s.user.familyId);
    expect(rows).toMatchObject({ families: 1, transactions: 1, accounts: 1 });
    const formerSelf = await prisma.familyMember.findUniqueOrThrow({
      where: { id: s.user.memberId },
    });
    expect(formerSelf.userId).toBeNull();
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/account',
      payload: { password: s.payload.password, confirm: 'DELETE' },
    });
    expect(res.statusCode).toBe(401);
  });
});

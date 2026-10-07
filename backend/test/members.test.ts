import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('family members', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    ({ cookie } = await signUp(app, { name: 'Surya' }));
  });
  afterEach(() => app.close());

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
    c = cookie,
  ) => app.inject({ method, url, headers: { cookie: c }, ...(payload ? { payload } : {}) });

  it('lists the registering user as a member', async () => {
    const res = await call('GET', '/api/members');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: expect.any(String), name: 'Surya', isUser: true }]);
  });

  it('creates, renames and deletes a member', async () => {
    const created = await call('POST', '/api/members', { name: '  Spouse ' });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    expect(created.json().data).toEqual({ id, name: 'Spouse', isUser: false });

    const renamed = await call('PUT', `/api/members/${id}`, { name: 'Priya' });
    expect(renamed.json().data.name).toBe('Priya');

    expect((await call('DELETE', `/api/members/${id}`)).statusCode).toBe(200);
    const names = (await call('GET', '/api/members'))
      .json()
      .data.map((m: { name: string }) => m.name);
    expect(names).toEqual(['Surya']);
  });

  it('rejects duplicate names case-insensitively, and the reserved name "Shared"', async () => {
    await call('POST', '/api/members', { name: 'Child' });
    const dup = await call('POST', '/api/members', { name: 'child' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('MEMBER_EXISTS');

    const shared = await call('POST', '/api/members', { name: 'Shared' });
    expect(shared.statusCode).toBe(400);
    expect(shared.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('allows renaming a member to a different case of its own name', async () => {
    const id = (await call('POST', '/api/members', { name: 'child' })).json().data.id;
    const res = await call('PUT', `/api/members/${id}`, { name: 'Child' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses to delete a member that is linked to a login', async () => {
    const [self] = (await call('GET', '/api/members')).json().data;
    const res = await call('DELETE', `/api/members/${self.id}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MEMBER_IS_USER');
  });

  it("isolates families: another family cannot see, edit or delete this family's members", async () => {
    const id = (await call('POST', '/api/members', { name: 'Spouse' })).json().data.id;
    const other = await signUp(app, { name: 'Mallory' });

    const list = await call('GET', '/api/members', undefined, other.cookie);
    expect(list.json().data.map((m: { name: string }) => m.name)).toEqual(['Mallory']);

    const put = await call('PUT', `/api/members/${id}`, { name: 'Hacked' }, other.cookie);
    expect(put.statusCode).toBe(404);
    const del = await call('DELETE', `/api/members/${id}`, undefined, other.cookie);
    expect(del.statusCode).toBe(404);
    expect((await prisma.familyMember.findUniqueOrThrow({ where: { id } })).name).toBe('Spouse');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed id with 400', async () => {
    const res = await call('PUT', '/api/members/not-a-uuid', { name: 'X' });
    expect(res.statusCode).toBe(400);
  });
});

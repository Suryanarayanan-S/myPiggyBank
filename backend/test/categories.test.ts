import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

type Cat = { id: string; name: string; kind: string; bucket: string | null };

describe('categories', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let familyId: string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    const s = await signUp(app, { name: 'Surya' });
    call = client(app, s.cookie);
    familyId = s.user.familyId;
  });
  afterEach(() => app.close());

  const list = async (): Promise<Cat[]> => (await call('GET', '/api/categories')).json().data;

  it('seeds default income and 50/30/20 bucket categories on register', async () => {
    const cats = await list();
    const count = (pred: (c: Cat) => boolean) => cats.filter(pred).length;
    expect(cats).toHaveLength(27);
    expect(count((c) => c.kind === 'income' && c.bucket === null)).toBe(6);
    expect(count((c) => c.bucket === 'essentials')).toBe(10);
    expect(count((c) => c.bucket === 'fun')).toBe(6);
    expect(count((c) => c.bucket === 'future')).toBe(5);
    expect(cats.find((c) => c.name === 'Rent')).toMatchObject({
      kind: 'expense',
      bucket: 'essentials',
    });
    expect(cats.find((c) => c.name === 'Salary')).toMatchObject({ kind: 'income', bucket: null });
  });

  it('seeds defaults lazily for families that have none (created before categories existed)', async () => {
    await prisma.category.deleteMany({ where: { familyId } });
    expect(await list()).toHaveLength(27);
  });

  it('requires a bucket for expense categories and forbids one for income', async () => {
    expect(
      (await call('POST', '/api/categories', { name: 'Baby', kind: 'expense' })).statusCode,
    ).toBe(400);
    const income = await call('POST', '/api/categories', {
      name: 'Gift',
      kind: 'income',
      bucket: 'fun',
    });
    expect(income.statusCode).toBe(400);
    const ok = await call('POST', '/api/categories', {
      name: 'Baby',
      kind: 'expense',
      bucket: 'essentials',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data).toMatchObject({ name: 'Baby', kind: 'expense', bucket: 'essentials' });
  });

  it('rejects duplicate names within a kind, but allows the same name across kinds', async () => {
    const dup = await call('POST', '/api/categories', {
      name: 'rent',
      kind: 'expense',
      bucket: 'fun',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CATEGORY_EXISTS');
    await call('POST', '/api/categories', { name: 'Other', kind: 'expense', bucket: 'fun' });
    const income = await call('POST', '/api/categories', { name: 'Other', kind: 'income' });
    expect(income.statusCode).toBe(201);
  });

  it('renames and moves an expense category between buckets; kind cannot change', async () => {
    const rent = (await list()).find((c) => c.name === 'Rent')!;
    const res = await call('PUT', `/api/categories/${rent.id}`, {
      name: 'Housing',
      bucket: 'fun',
      kind: 'income',
    });
    expect(res.json().data).toMatchObject({ name: 'Housing', bucket: 'fun', kind: 'expense' });
  });

  it('refuses a bucket on an income category update', async () => {
    const salary = (await list()).find((c) => c.name === 'Salary')!;
    expect((await call('PUT', `/api/categories/${salary.id}`, { bucket: 'fun' })).statusCode).toBe(
      400,
    );
  });

  it('deletes an unused category', async () => {
    const gifts = (await list()).find((c) => c.name === 'Gifts')!;
    expect((await call('DELETE', `/api/categories/${gifts.id}`)).statusCode).toBe(200);
    expect((await list()).some((c) => c.name === 'Gifts')).toBe(false);
  });

  it('isolates families', async () => {
    const rent = (await list()).find((c) => c.name === 'Rent')!;
    const other = client(app, (await signUp(app, { name: 'Mallory' })).cookie);
    expect((await other('PUT', `/api/categories/${rent.id}`, { name: 'X' })).statusCode).toBe(404);
    expect((await other('DELETE', `/api/categories/${rent.id}`)).statusCode).toBe(404);
  });
});

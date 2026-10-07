import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

type Call = ReturnType<typeof client>;

async function setupFamily(app: FastifyInstance, name: string) {
  const s = await signUp(app, { name });
  const call = client(app, s.cookie);
  const acc = async (body: object) => (await call('POST', '/api/accounts', body)).json().data;
  const sparkasse = await acc({
    name: 'Sparkasse',
    type: 'current',
    currency: 'EUR',
    openingBalance: 100_000,
  });
  const revolut = await acc({ name: 'Revolut', type: 'current', currency: 'EUR' });
  const icici = await acc({ name: 'ICICI', type: 'savings', currency: 'INR' });
  const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const [me] = (await call('GET', '/api/members')).json().data;
  const spouse = (await call('POST', '/api/members', { name: 'Spouse' })).json().data;
  return { call, sparkasse, revolut, icici, cat, me, spouse };
}

describe('transactions', () => {
  let app: FastifyInstance;
  let f: Awaited<ReturnType<typeof setupFamily>>;
  let call: Call;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    f = await setupFamily(app, 'Surya');
    call = f.call;
  });
  afterEach(() => app.close());

  const balances = async () =>
    Object.fromEntries(
      ((await call('GET', '/api/accounts')).json().data as { name: string; balance: number }[]).map(
        (a) => [a.name, a.balance],
      ),
    );
  const create = (body: object) => call('POST', '/api/transactions', body);
  const salary = () => ({
    date: '2026-10-01',
    amount: 541_600,
    type: 'income',
    accountId: f.sparkasse.id,
    categoryId: f.cat('Salary'),
    merchant: 'Employer GmbH',
  });
  const groceries = () => ({
    date: '2026-10-07',
    amount: 5_240,
    type: 'expense',
    accountId: f.sparkasse.id,
    categoryId: f.cat('Groceries'),
    memberId: f.spouse.id,
    merchant: 'REWE',
    notes: 'weekly shop',
    tags: [' Food ', 'food', 'Weekly'],
  });

  it('creates income and expense transactions and updates the balance', async () => {
    expect((await create(salary())).statusCode).toBe(201);
    const res = await create(groceries());
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      date: '2026-10-07',
      amount: 5_240,
      currency: 'EUR',
      type: 'expense',
      accountName: 'Sparkasse',
      categoryName: 'Groceries',
      bucket: 'essentials',
      memberName: 'Spouse',
      merchant: 'REWE',
      tags: ['food', 'weekly'],
    });
    expect((await balances()).Sparkasse).toBe(100_000 + 541_600 - 5_240);
  });

  it('moves money between same-currency accounts; transferAmount defaults to amount', async () => {
    const res = await create({
      date: '2026-10-02',
      amount: 20_000,
      type: 'transfer',
      accountId: f.sparkasse.id,
      transferAccountId: f.revolut.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      transferAmount: 20_000,
      transferAccountName: 'Revolut',
    });
    expect(await balances()).toMatchObject({ Sparkasse: 80_000, Revolut: 20_000 });
  });

  it('requires transferAmount between different currencies and uses it for the destination', async () => {
    const base = {
      date: '2026-10-02',
      amount: 10_000,
      type: 'transfer',
      accountId: f.sparkasse.id,
      transferAccountId: f.icici.id,
    };
    const missing = await create(base);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('TRANSFER_AMOUNT_REQUIRED');
    const ok = await create({ ...base, transferAmount: 978_500 });
    expect(ok.json().data).toMatchObject({ transferCurrency: 'INR', transferAmount: 978_500 });
    expect(await balances()).toMatchObject({ Sparkasse: 90_000, ICICI: 978_500 });
  });

  it.each([
    ['transfer to the same account', { type: 'transfer', transferAccountId: 'SELF' }],
    [
      'transfer with a category',
      { type: 'transfer', transferAccountId: 'REVOLUT', categoryId: 'GROCERIES' },
    ],
    ['transfer without destination', { type: 'transfer' }],
    ['income category on an expense', { categoryId: 'SALARY' }],
    ['expense category on income', { type: 'income', categoryId: 'GROCERIES' }],
    ['zero amount', { amount: 0 }],
    ['negative amount', { amount: -5 }],
    ['fractional cents', { amount: 10.5 }],
    ['impossible date', { date: '2026-02-30' }],
    ['badly formatted date', { date: '07.10.2026' }],
  ])('rejects %s with 400', async (_label, patch) => {
    const ids: Record<string, string> = {
      SELF: f.sparkasse.id,
      REVOLUT: f.revolut.id,
      GROCERIES: f.cat('Groceries'),
      SALARY: f.cat('Salary'),
    };
    const body = Object.fromEntries(
      Object.entries({ ...groceries(), memberId: undefined, ...patch }).map(([k, v]) => [
        k,
        typeof v === 'string' && v in ids ? ids[v] : v,
      ]),
    );
    if ((patch as { type?: string }).type === 'transfer' && !('categoryId' in patch))
      delete body.categoryId;
    const res = await create(body);
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("rejects references to another family's account, category, member or transfer account (404, nothing written)", async () => {
    const other = await setupFamily(app, 'Mallory');
    const attempts = [
      { ...groceries(), accountId: other.sparkasse.id },
      { ...groceries(), categoryId: other.cat('Groceries') },
      { ...groceries(), memberId: other.spouse.id },
      {
        date: '2026-10-02',
        amount: 100,
        type: 'transfer',
        accountId: f.sparkasse.id,
        transferAccountId: other.revolut.id,
      },
    ];
    for (const body of attempts) {
      const res = await create(body);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.message).toMatch(/^(Account|Category|Family member) not found$/);
    }
    expect(await prisma.transaction.count()).toBe(0);
  });

  describe('listing', () => {
    beforeEach(async () => {
      await create(salary());
      await create(groceries());
      await create({
        date: '2026-09-15',
        amount: 91_200,
        type: 'expense',
        accountId: f.sparkasse.id,
        categoryId: f.cat('Rent'),
        merchant: 'Landlord',
      });
      await create({
        date: '2026-10-03',
        amount: 1_299,
        type: 'expense',
        accountId: f.revolut.id,
        categoryId: f.cat('Subscriptions'),
        memberId: f.me.id,
        merchant: 'Netflix',
      });
      await create({
        date: '2026-10-04',
        amount: 5_000,
        type: 'transfer',
        accountId: f.sparkasse.id,
        transferAccountId: f.revolut.id,
      });
    });
    const list = async (qs = '') => (await call('GET', `/api/transactions${qs}`)).json().data;
    const merchants = (d: { items: { merchant: string | null }[] }) =>
      d.items.map((t) => t.merchant);

    it('lists newest first with a total', async () => {
      const d = await list();
      expect(d.total).toBe(5);
      expect(d.items[0].date).toBe('2026-10-07');
      expect(d.items.at(-1).date).toBe('2026-09-15');
    });

    it('filters by date range (inclusive)', async () => {
      expect((await list('?from=2026-10-01&to=2026-10-03')).total).toBe(2);
      expect(merchants(await list('?from=2026-09-01&to=2026-09-30'))).toEqual(['Landlord']);
    });

    it('filters by type, account (including transfer destination), category and member', async () => {
      expect((await list('?type=income')).total).toBe(1);
      expect((await list(`?accountId=${f.revolut.id}`)).total).toBe(2);
      expect(merchants(await list(`?categoryId=${f.cat('Rent')}`))).toEqual(['Landlord']);
      expect(merchants(await list(`?memberId=${f.spouse.id}`))).toEqual(['REWE']);
      expect((await list('?memberId=shared')).total).toBe(3);
    });

    it('searches merchant, notes, tags and category name case-insensitively', async () => {
      expect(merchants(await list('?q=rewe'))).toEqual(['REWE']);
      expect(merchants(await list('?q=WEEKLY%20SHOP'))).toEqual(['REWE']);
      expect(merchants(await list('?q=food'))).toEqual(['REWE']);
      expect(merchants(await list('?q=subscript'))).toEqual(['Netflix']);
    });

    it('sorts by amount and paginates', async () => {
      const d = await list('?sort=amount&order=asc&pageSize=2&page=2');
      expect(d).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(d.items.map((t: { amount: number }) => t.amount)).toEqual([5_240, 91_200]);
    });

    it('returns per-currency totals for the whole filtered set, not just the page', async () => {
      const d = await list('?pageSize=1');
      expect(d.items).toHaveLength(1);
      expect(d.totals).toEqual([
        { currency: 'EUR', income: 541_600, expense: 5_240 + 91_200 + 1_299 },
      ]);
      const oct = await list('?from=2026-10-01&to=2026-10-31&type=expense&pageSize=1');
      expect(oct.totals).toEqual([{ currency: 'EUR', income: 0, expense: 5_240 + 1_299 }]);
    });

    it('rejects an invalid filter', async () => {
      expect((await call('GET', '/api/transactions?type=gift')).statusCode).toBe(400);
      expect((await call('GET', '/api/transactions?pageSize=500')).statusCode).toBe(400);
    });
  });

  it('edits a transaction and the balance follows', async () => {
    const id = (await create(groceries())).json().data.id;
    const res = await call('PUT', `/api/transactions/${id}`, { ...groceries(), amount: 10_000 });
    expect(res.json().data.amount).toBe(10_000);
    expect((await balances()).Sparkasse).toBe(90_000);
  });

  it('deletes a transaction', async () => {
    const id = (await create(groceries())).json().data.id;
    expect((await call('DELETE', `/api/transactions/${id}`)).statusCode).toBe(200);
    expect((await balances()).Sparkasse).toBe(100_000);
  });

  it('refuses to delete an account or category still used by transactions (409)', async () => {
    await create(groceries());
    const acc = await call('DELETE', `/api/accounts/${f.sparkasse.id}`);
    expect(acc.statusCode).toBe(409);
    expect(acc.json().error.code).toBe('ACCOUNT_IN_USE');
    const cat = await call('DELETE', `/api/categories/${f.cat('Groceries')}`);
    expect(cat.statusCode).toBe(409);
    expect(cat.json().error.code).toBe('CATEGORY_IN_USE');
  });

  it("isolates families: another family cannot read, edit or delete this family's transactions", async () => {
    const id = (await create(groceries())).json().data.id;
    const other = await setupFamily(app, 'Mallory');
    expect((await other.call('GET', '/api/transactions')).json().data.total).toBe(0);
    expect((await other.call('PUT', `/api/transactions/${id}`, groceries())).statusCode).toBe(404);
    expect((await other.call('DELETE', `/api/transactions/${id}`)).statusCode).toBe(404);
  });
});

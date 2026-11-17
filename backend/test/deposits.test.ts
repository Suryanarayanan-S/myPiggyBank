import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { addMonths, savingsValue } from '../src/domain/deposits.js';
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

  it('counts as what it is chosen to be (an investment unless said otherwise)', async () => {
    const id = (await call('POST', '/api/deposits', fd())).json().data.id;
    const byClass = async () =>
      (await call('GET', '/api/net-worth')).json().data.current.byClass as Record<string, number>;
    const value = (await call('GET', '/api/deposits')).json().data.deposits[0].value;
    expect((await call('GET', '/api/deposits')).json().data.deposits[0].assetClass).toBe(
      'investment',
    );
    expect((await byClass()).investment).toBe(value);
    // an emergency fund: counted with the money at hand
    await call('PUT', `/api/deposits/${id}`, { assetClass: 'liquid' });
    expect(await byClass()).toMatchObject({ liquid: value, investment: 0 });
    const made = await call('POST', '/api/deposits', fd({ name: 'Other', assetClass: 'liquid' }));
    expect(made.json().data.assetClass).toBe('liquid');
    expect((await call('POST', '/api/deposits', fd({ assetClass: 'gold' }))).statusCode).toBe(400);
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

  describe('recurring deposits', () => {
    let rdCategory: string;
    const rd = (extra: object = {}) => ({
      kind: 'rd',
      name: 'Post office RD',
      currency: 'INR',
      accountId: savings,
      principal: 100_000, // ₹1,000 a month
      rateBp: 700,
      startDate: today,
      months: 12,
      compounding: 'quarterly',
      ...extra,
    });
    const rules = async () => (await call('GET', '/api/recurring')).json().data;
    const instalments = async () =>
      (await call('GET', `/api/transactions?accountId=${savings}`))
        .json()
        .data.items.filter((t: { merchant: string | null; notes: string | null }) =>
          JSON.stringify(t).includes('Post office RD'),
        );
    beforeEach(async () => {
      rdCategory = (
        await call('POST', '/api/categories', { name: 'RD', kind: 'expense', bucket: 'future' })
      ).json().data.id;
    });

    it('is valued from its instalments and books each one from the account', async () => {
      const res = await call('POST', '/api/deposits', rd({ book: { categoryId: rdCategory } }));
      expect(res.statusCode).toBe(201);
      const d = (await call('GET', '/api/deposits')).json().data.deposits[0];
      expect(d).toMatchObject({
        kind: 'rd',
        instalment: 100_000,
        months: 12,
        instalmentsDue: 1,
        principal: 100_000, // put in so far: today's instalment
        value: 100_000,
        maturityAmount: 1_246_213, // Σ 1,000 × 1.0175^(i/3)
        maturityDate: addMonths(today, 12),
        interest: 'reinvest',
        book: { categoryId: rdCategory },
      });
      // the monthly rule, until the last instalment; today's is booked
      expect(await rules()).toMatchObject([
        {
          name: 'Post office RD',
          type: 'expense',
          amount: 100_000,
          frequency: 'monthly',
          endDate: addMonths(today, 11),
        },
      ]);
      expect(await instalments()).toHaveLength(1);
    });

    it('stops booking when unticked, paid out or deleted (what was booked stays)', async () => {
      const id = (
        await call('POST', '/api/deposits', rd({ book: { categoryId: rdCategory } }))
      ).json().data.id;
      await call('PUT', `/api/deposits/${id}`, { book: null });
      expect(await rules()).toEqual([]);
      expect(await instalments()).toHaveLength(1);
      // booked again: from tomorrow, so today's instalment is not booked twice
      await call('PUT', `/api/deposits/${id}`, { book: { categoryId: rdCategory } });
      expect(await rules()).toHaveLength(1);
      expect(await instalments()).toHaveLength(1);
      // a new instalment amount follows into the rule
      await call('PUT', `/api/deposits/${id}`, { principal: 150_000 });
      expect((await rules())[0]).toMatchObject({ amount: 150_000 });
      // paid out: the rule stops
      await call('PUT', `/api/deposits/${id}`, { closedAt: today });
      expect((await rules())[0]).toMatchObject({ active: false });
      await call('DELETE', `/api/deposits/${id}`);
      expect(await rules()).toEqual([]);
      expect(await instalments()).toHaveLength(1);
    });

    it('books the last instalment of an RD started on the 31st', async () => {
      await call(
        'POST',
        '/api/deposits',
        rd({ startDate: '2026-03-31', months: 6, book: { categoryId: rdCategory } }),
      );
      expect((await rules())[0]).toMatchObject({ endDate: '2026-08-31' });
    });

    it('resumes booking when reopened; nothing is saved when booking cannot work', async () => {
      const id = (
        await call('POST', '/api/deposits', rd({ book: { categoryId: rdCategory } }))
      ).json().data.id;
      await call('PUT', `/api/deposits/${id}`, { closedAt: today });
      expect((await call('GET', '/api/deposits')).json().data.deposits[0].book).toBeNull();
      await call('PUT', `/api/deposits/${id}`, { closedAt: null });
      expect((await rules())[0]).toMatchObject({ active: true });
      expect((await call('GET', '/api/deposits')).json().data.deposits[0].book).toEqual({
        categoryId: rdCategory,
      });
      // no account to book from: refused, and the deposit keeps its account
      const res = await call('PUT', `/api/deposits/${id}`, { accountId: null });
      expect(res.statusCode).toBe(400);
      expect((await call('GET', '/api/deposits')).json().data.deposits[0].accountId).toBe(savings);
      // an income category cannot take the instalment
      const income = (
        await call('POST', '/api/categories', { name: 'RD test income', kind: 'income' })
      ).json().data.id;
      const before = (await rules()).length;
      expect(
        (await call('POST', '/api/deposits', rd({ name: 'X', book: { categoryId: income } })))
          .statusCode,
      ).toBe(400);
      expect((await call('GET', '/api/deposits')).json().data.deposits).toHaveLength(1);
      expect(await rules()).toHaveLength(before);
    });

    it('cannot be made shorter than the instalments already paid', async () => {
      const id = (
        await call('POST', '/api/deposits', rd({ startDate: addMonths(today, -5) }))
      ).json().data.id;
      expect((await call('PUT', `/api/deposits/${id}`, { months: 4 })).statusCode).toBe(400);
      expect((await call('PUT', `/api/deposits/${id}`, { months: 6 })).statusCode).toBe(200);
    });

    it('needs an account to book from, and the number of months', async () => {
      const bad = async (body: object) =>
        (await call('POST', '/api/deposits', rd(body))).statusCode;
      expect(await bad({ accountId: null, book: { categoryId: rdCategory } })).toBe(400);
      expect(await bad({ months: undefined })).toBe(400);
      expect(await bad({ months: 0 })).toBe(400);
      expect(await rules()).toEqual([]);
      // without booking, no account is needed
      expect(await bad({ accountId: null })).toBe(201);
    });

    it('counts in net worth at its value, or at the instalments paid', async () => {
      await call('POST', '/api/deposits', rd({ startDate: addMonths(today, -3) }));
      const d = (await call('GET', '/api/deposits')).json().data.deposits[0];
      expect(d.instalmentsDue).toBe(4);
      expect(d.principal).toBe(400_000);
      const worth = async () => (await call('GET', '/api/net-worth')).json().data.current.assets;
      expect(await worth()).toBe(d.value);
      await call('PUT', '/api/family', { investmentsAt: 'invested' });
      expect(await worth()).toBe(400_000);
    });
  });

  describe('instant-access savings', () => {
    const start = addMonths(today, -2);
    const sav = (extra: object = {}) => ({
      kind: 'savings',
      name: 'Tagesgeld',
      currency: 'INR',
      principal: 1_000_000,
      rateBp: 300,
      startDate: start,
      compounding: 'monthly',
      accountId: savings,
      ...extra,
    });
    const txn = (extra: object) =>
      call('POST', '/api/transactions', {
        date: addMonths(today, -1),
        amount: 200_000,
        type: 'expense',
        accountId: savings,
        ...extra,
      });
    const list = async () => (await call('GET', '/api/deposits')).json().data.deposits;

    it('has no maturity, earns every day and counts as money at hand', async () => {
      const res = await call('POST', '/api/deposits', sav({ maturityDate: '2030-01-01' }));
      expect(res.statusCode).toBe(201);
      const [d] = await list();
      const expected = savingsValue(
        {
          opening: 1_000_000,
          start,
          rates: [{ from: start, rateBp: 300 }],
          compounding: 'monthly',
          movements: [],
        },
        today,
      )!;
      expect(d).toMatchObject({
        name: 'Tagesgeld Instant',
        kind: 'savings',
        maturityDate: null,
        maturityAmount: null,
        daysLeft: null,
        status: 'active',
        assetClass: 'liquid',
        principal: 1_000_000,
        value: expected.value,
        rates: [{ from: start, rateBp: 300 }],
        movements: [],
      });
      expect(d.value).toBeGreaterThan(1_000_000);
      const nw = (await call('GET', '/api/net-worth')).json().data.current;
      expect(nw.assets).toBe(d.value);
      // an opening amount of zero is fine: the money can come with its transactions
      expect((await call('POST', '/api/deposits', sav({ principal: 0 }))).statusCode).toBe(201);
    });

    it('follows the transactions linked to it: expenses in, income out', async () => {
      const id = (await call('POST', '/api/deposits', sav({ principal: 0 }))).json().data.id;
      const t1 = (await txn({ depositId: id, merchant: 'To savings' })).json().data;
      expect(t1).toMatchObject({ depositId: id, depositName: 'Tagesgeld Instant' });
      await txn({ depositId: id, type: 'income', amount: 50_000, date: today });
      const [d] = await list();
      expect(d.principal).toBe(150_000);
      expect(d.value).toBeGreaterThan(150_000);
      expect(d.movements).toEqual([
        expect.objectContaining({
          date: today,
          amount: -50_000,
          transactionId: expect.any(String),
        }),
        expect.objectContaining({
          date: addMonths(today, -1),
          amount: 200_000,
          label: 'To savings',
        }),
      ]);
      // unlinked again: no longer counted
      await call('PUT', `/api/transactions/${t1.id}`, {
        date: addMonths(today, -1),
        amount: 200_000,
        type: 'expense',
        accountId: savings,
        depositId: null,
      });
      expect((await list())[0].principal).toBe(-50_000);
      // an edit that leaves the deposit out keeps it
      const t3 = (await txn({ depositId: id })).json().data;
      const kept = await call('PUT', `/api/transactions/${t3.id}`, {
        date: today,
        amount: 300_000,
        type: 'expense',
        accountId: savings,
      });
      expect(kept.json().data.depositId).toBe(id);
    });

    it('links only income and expenses, in the deposit’s currency, of the same family', async () => {
      const id = (await call('POST', '/api/deposits', sav())).json().data.id;
      const eur = (
        await call('POST', '/api/accounts', {
          name: 'N26',
          type: 'current',
          currency: 'EUR',
          openingBalance: 0,
        })
      ).json().data.id;
      expect((await txn({ depositId: id, accountId: eur })).statusCode).toBe(400);
      expect(
        (await txn({ depositId: id, type: 'transfer', transferAccountId: eur, transferAmount: 1 }))
          .statusCode,
      ).toBe(400);
      const other = client(app, (await signUp(app)).cookie);
      const theirs = (await other('POST', '/api/deposits', sav({ accountId: null }))).json().data
        .id;
      expect((await txn({ depositId: theirs })).statusCode).toBe(404);
    });

    it('changes its rate from a day on, keeping the earlier interest', async () => {
      const id = (await call('POST', '/api/deposits', sav())).json().data.id;
      const before = (await list())[0].value;
      const from = addMonths(today, -1);
      const res = await call('PUT', `/api/deposits/${id}`, { rateBp: 200, rateFrom: from });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        rateBp: 200,
        rates: [
          { from: start, rateBp: 300 },
          { from, rateBp: 200 },
        ],
      });
      const after = (await list())[0].value;
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(1_000_000);
      // without a day, the new rate is from today
      await call('PUT', `/api/deposits/${id}`, { rateBp: 250 });
      expect((await list())[0].rates.at(-1)).toEqual({ from: today, rateBp: 250 });
      // a change planned for later survives an edit that sends today's rate unchanged
      const later = addDays(today, 10);
      await call('PUT', `/api/deposits/${id}`, { rateBp: 350, rateFrom: later });
      await call('PUT', `/api/deposits/${id}`, { name: 'Renamed', rateBp: 250 });
      expect((await list())[0].rates.at(-1)).toEqual({ from: later, rateBp: 350 });
    });

    it('keeps its currency while transactions are linked; a transfer lets go of the link', async () => {
      const id = (await call('POST', '/api/deposits', sav())).json().data.id;
      const t = (await txn({ depositId: id })).json().data;
      const eur = { currency: 'EUR', accountId: null };
      expect((await call('PUT', `/api/deposits/${id}`, eur)).statusCode).toBe(400);
      const other = (
        await call('POST', '/api/accounts', {
          name: 'ICICI',
          type: 'savings',
          currency: 'INR',
          openingBalance: 0,
        })
      ).json().data.id;
      const moved = await call('PUT', `/api/transactions/${t.id}`, {
        date: today,
        amount: 200_000,
        type: 'transfer',
        accountId: savings,
        transferAccountId: other,
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().data.depositId).toBeNull();
      expect((await call('PUT', `/api/deposits/${id}`, eur)).statusCode).toBe(200);
    });

    it('lets go of its transactions when deleted', async () => {
      const id = (await call('POST', '/api/deposits', sav())).json().data.id;
      const t = (await txn({ depositId: id })).json().data;
      await call('DELETE', `/api/deposits/${id}`);
      const again = (await call('GET', '/api/transactions')).json().data.items;
      expect(again.find((x: { id: string }) => x.id === t.id)).toMatchObject({ depositId: null });
    });
  });

  it('lists the transactions linked to a fixed deposit', async () => {
    const id = (await call('POST', '/api/deposits', fd({ accountId: savings }))).json().data.id;
    await call('POST', '/api/transactions', {
      date: '2026-01-15',
      amount: 10_000_000,
      type: 'expense',
      accountId: savings,
      depositId: id,
    });
    const [d] = (await call('GET', '/api/deposits')).json().data.deposits;
    expect(d.movements).toEqual([
      expect.objectContaining({ date: '2026-01-15', amount: 10_000_000 }),
    ]);
    // its value still comes from its terms
    expect(d.principal).toBe(10_000_000);
  });

  describe('linking from the deposit', () => {
    const pay = async (extra: object) =>
      (
        await call('POST', '/api/transactions', {
          date: '2026-01-15',
          amount: 10_000_000,
          type: 'expense',
          accountId: savings,
          ...extra,
        })
      ).json().data;

    it('suggests the payments that look like it, and links and unlinks them in one go', async () => {
      const id = (await call('POST', '/api/deposits', fd({ accountId: savings }))).json().data.id;
      const opening = await pay({ merchant: 'FD booking' });
      const groceries = await pay({ amount: 5_000, date: '2026-03-01', merchant: 'Shop' });
      const elsewhere = await pay({ accountId: null, currency: 'EUR', merchant: 'FD' });
      const res = await call('GET', `/api/deposits/candidates?depositId=${id}`);
      expect(res.statusCode).toBe(200);
      const items = res.json().data.items;
      // its currency only, the likely one first
      expect(items.map((i: { id: string }) => i.id)).toEqual([opening.id, groceries.id]);
      expect(items[0]).toMatchObject({ suggested: true, text: 'FD booking', amount: 10_000_000 });
      expect(items[1]).toMatchObject({ suggested: false });
      expect(items.find((i: { id: string }) => i.id === elsewhere.id)).toBeUndefined();

      const linked = await call('PUT', `/api/deposits/${id}/transactions`, {
        add: [opening.id, groceries.id],
      });
      expect(linked.statusCode).toBe(200);
      expect(linked.json().data.movements).toHaveLength(2);
      // linked ones are no longer offered
      const again = (await call('GET', `/api/deposits/candidates?depositId=${id}`)).json().data;
      expect(again.items).toEqual([]);
      const un = await call('PUT', `/api/deposits/${id}/transactions`, { remove: [groceries.id] });
      expect(
        un.json().data.movements.map((m: { transactionId: string }) => m.transactionId),
      ).toEqual([opening.id]);
    });

    it('never takes a transaction from another deposit, nor links to a closed one', async () => {
      const a = (await call('POST', '/api/deposits', fd())).json().data.id;
      const b = (await call('POST', '/api/deposits', fd({ name: 'Other FD' }))).json().data.id;
      const t = await pay({});
      await call('PUT', `/api/deposits/${a}/transactions`, { add: [t.id] });
      const put = (id: string) => call('PUT', `/api/deposits/${id}/transactions`, { add: [t.id] });
      expect((await put(b)).statusCode).toBe(400);
      expect(
        (await call('POST', '/api/deposits', fd({ name: 'New', transactionIds: [t.id] })))
          .statusCode,
      ).toBe(400);
      await call('PUT', `/api/deposits/${b}`, { closedAt: today });
      const free = await pay({ amount: 7 });
      expect(
        (await call('PUT', `/api/deposits/${b}/transactions`, { add: [free.id] })).statusCode,
      ).toBe(400);
      const list = (await call('GET', '/api/deposits')).json().data.deposits;
      expect(list.find((x: { id: string }) => x.id === a).movements).toHaveLength(1);
      expect(list).toHaveLength(2);
    });

    it('names end with the kind, also after an edit', async () => {
      const id = (await call('POST', '/api/deposits', fd({ name: 'SBI' }))).json().data.id;
      const renamed = await call('PUT', `/api/deposits/${id}`, { name: 'SBI tax saver' });
      expect(renamed.json().data.name).toBe('SBI tax saver FD');
      expect(
        (await call('POST', '/api/deposits', fd({ name: 'Canara FD' }))).json().data.name,
      ).toBe('Canara FD');
    });

    it('links only its family’s income and payments in its currency', async () => {
      const id = (await call('POST', '/api/deposits', fd())).json().data.id;
      const eur = await pay({ accountId: null, currency: 'EUR' });
      const put = (add: string[]) => call('PUT', `/api/deposits/${id}/transactions`, { add });
      expect((await put([eur.id])).statusCode).toBe(400);
      const other = client(app, (await signUp(app)).cookie);
      const theirs = (
        await other('POST', '/api/transactions', {
          date: today,
          amount: 100,
          type: 'expense',
          accountId: null,
          currency: 'INR',
        })
      ).json().data;
      expect((await put([theirs.id])).statusCode).toBe(404);
      expect((await call('GET', '/api/deposits')).json().data.deposits[0].movements).toEqual([]);
    });

    it('is opened with a payment: chosen in the form, linked when saved', async () => {
      const p = await pay({ merchant: 'Festgeld' });
      // before it exists: the account's recent payments in its currency, deposit words first
      const res = await call('GET', `/api/deposits/candidates?currency=INR&accountId=${savings}`);
      expect(res.json().data.items[0]).toMatchObject({ id: p.id, suggested: true });
      const made = await call(
        'POST',
        '/api/deposits',
        fd({ accountId: savings, transactionIds: [p.id] }),
      );
      expect(made.statusCode).toBe(201);
      expect(made.json().data.movements).toEqual([
        expect.objectContaining({ transactionId: p.id, amount: 10_000_000 }),
      ]);
      // a payment that cannot be linked: nothing is saved
      const bad = await pay({ accountId: null, currency: 'EUR' });
      expect(
        (await call('POST', '/api/deposits', fd({ name: 'X', transactionIds: [bad.id] })))
          .statusCode,
      ).toBe(400);
      expect((await call('GET', '/api/deposits')).json().data.deposits).toHaveLength(1);
    });
  });
});

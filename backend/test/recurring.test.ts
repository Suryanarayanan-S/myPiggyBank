import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateDue } from '../src/services/recurringService.js';
import { nextOccurrence } from '../src/domain/recurring.js';
import { client, makeApp, prisma, resetDb, signUp } from './helpers.js';

describe('recurring transactions', () => {
  let app: FastifyInstance;
  let call: ReturnType<typeof client>;
  let familyId: string;
  let acc: { id: string };
  let cat: (n: string) => string;
  beforeEach(async () => {
    await resetDb();
    app = await makeApp();
    const s = await signUp(app);
    call = client(app, s.cookie);
    familyId = s.user.familyId;
    acc = (
      await call('POST', '/api/accounts', { name: 'Sparkasse', type: 'current', currency: 'EUR' })
    ).json().data;
    const cats: { id: string; name: string }[] = (await call('GET', '/api/categories')).json().data;
    cat = (n) => cats.find((c) => c.name === n)!.id;
  });
  afterEach(() => app.close());

  const rent = (p: object = {}) => ({
    name: 'Rent',
    type: 'expense',
    amount: 91_200,
    accountId: acc.id,
    categoryId: cat('Rent'),
    frequency: 'monthly',
    startDate: '2026-01-31',
    ...p,
  });
  const generated = () =>
    prisma.transaction.findMany({
      where: { recurringRuleId: { not: null } },
      orderBy: { date: 'asc' },
    });
  const dates = async () => (await generated()).map((t) => t.date.toISOString().slice(0, 10));

  it('back-fills from the start date when asked, up to the run date, clamping to month ends', async () => {
    // Starts in 2027, so creating it (which generates up to today) adds nothing yet.
    const res = await call(
      'POST',
      '/api/recurring',
      rent({ backfill: true, startDate: '2027-01-31' }),
    );
    expect(res.statusCode).toBe(201);
    await generateDue(prisma, '2027-04-15', familyId);
    expect(await dates()).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    const t = (await generated())[0]!;
    expect(t).toMatchObject({
      type: 'expense',
      merchant: 'Rent',
      categoryId: cat('Rent'),
      accountId: acc.id,
    });
  });

  it('without back-fill, starts from the day the rule was created', async () => {
    const rule = (await call('POST', '/api/recurring', rent())).json().data;
    await prisma.recurringRule.update({
      where: { id: rule.id },
      data: { generateFrom: new Date('2026-03-15T00:00:00Z'), generatedThrough: null },
    });
    await generateDue(prisma, '2026-05-01', familyId);
    expect(await dates()).toEqual(['2026-03-31', '2026-04-30']);
  });

  it('is idempotent, never creates future transactions, and respects end date and pause', async () => {
    const rule = (
      await call('POST', '/api/recurring', rent({ backfill: true, endDate: '2026-03-31' }))
    ).json().data;
    await generateDue(prisma, '2026-12-31', familyId);
    await generateDue(prisma, '2026-12-31', familyId);
    expect(await dates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    await call('PUT', `/api/recurring/${rule.id}`, { active: false, endDate: null });
    await generateDue(prisma, '2027-12-31', familyId);
    expect(await dates()).toHaveLength(3);
  });

  it('editing the amount affects only future transactions; deleting keeps past ones', async () => {
    const rule = (
      await call('POST', '/api/recurring', rent({ backfill: true, startDate: '2027-01-31' }))
    ).json().data;
    await generateDue(prisma, '2027-02-28', familyId);
    await call('PUT', `/api/recurring/${rule.id}`, { amount: 95_000 });
    await generateDue(prisma, '2027-03-31', familyId);
    expect((await generated()).map((t) => Number(t.amount))).toEqual([91_200, 91_200, 95_000]);
    await call('DELETE', `/api/recurring/${rule.id}`);
    expect(await prisma.transaction.count()).toBe(3);
  });

  it('lists rules with their next date and shows upcoming transactions', async () => {
    await call('POST', '/api/recurring', rent({ startDate: '2099-01-31' }));
    const list = (await call('GET', '/api/recurring')).json().data;
    expect(list[0]).toMatchObject({
      name: 'Rent',
      nextDate: '2099-01-31',
      currency: 'EUR',
      accountName: 'Sparkasse',
    });
    const upcoming = (await call('GET', '/api/recurring/upcoming?days=30')).json().data;
    expect(upcoming).toEqual([]);
  });

  it('validates input', async () => {
    for (const p of [
      { amount: 0 },
      { frequency: 'daily' },
      { startDate: '2026-02-30' },
      { categoryId: cat('Salary') },
    ]) {
      expect((await call('POST', '/api/recurring', rent(p))).statusCode).toBe(400);
    }
  });

  it('isolates families', async () => {
    const rule = (await call('POST', '/api/recurring', rent())).json().data;
    const other = client(app, (await signUp(app)).cookie);
    expect((await other('GET', '/api/recurring')).json().data).toEqual([]);
    expect((await other('PUT', `/api/recurring/${rule.id}`, { amount: 1 })).statusCode).toBe(404);
    expect((await other('DELETE', `/api/recurring/${rule.id}`)).statusCode).toBe(404);
    const otherAcc = (
      await other('POST', '/api/accounts', { name: 'X', type: 'cash', currency: 'EUR' })
    ).json().data;
    expect(
      (await call('POST', '/api/recurring', rent({ accountId: otherAcc.id }))).statusCode,
    ).toBe(404);
  });

  it("shows the next date after today's already-created transaction", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rule = (await call('POST', '/api/recurring', rent({ startDate: today }))).json().data;
    expect(await dates()).toEqual([today]);
    expect(rule.nextDate).toBe(
      nextOccurrence({ frequency: 'monthly', startDate: today, endDate: null }, today),
    );
    expect(rule.nextDate > today).toBe(true);
  });

  it('does not bring back a generated transaction the user deleted or moved', async () => {
    const rule = (
      await call('POST', '/api/recurring', rent({ backfill: true, startDate: '2027-01-31' }))
    ).json().data;
    await generateDue(prisma, '2027-03-31', familyId);
    const [jan, feb] = await generated();
    await prisma.transaction.delete({ where: { id: jan!.id } });
    await call('PUT', `/api/transactions/${feb!.id}`, {
      date: '2027-03-01',
      amount: 91_200,
      type: 'expense',
      accountId: acc.id,
      categoryId: cat('Rent'),
    });
    await generateDue(prisma, '2027-03-31', familyId);
    await generateDue(prisma, '2027-04-30', familyId);
    expect(await prisma.transaction.count({ where: { recurringRuleId: rule.id } })).toBe(3); // moved Feb, Mar, Apr
  });

  it('resuming a paused rule does not create the months it was paused for', async () => {
    const rule = (
      await call('POST', '/api/recurring', rent({ backfill: true, startDate: '2027-01-31' }))
    ).json().data;
    await generateDue(prisma, '2027-01-31', familyId);
    await call('PUT', `/api/recurring/${rule.id}`, { active: false });
    await prisma.recurringRule.update({ where: { id: rule.id }, data: { updatedAt: new Date() } });
    // Resume "today" (real today is before 2027, so pretend resume happens in May 2027).
    await call('PUT', `/api/recurring/${rule.id}`, { active: true });
    await prisma.recurringRule.update({
      where: { id: rule.id },
      data: { generateFrom: new Date('2027-05-15T00:00:00Z') },
    });
    await generateDue(prisma, '2027-06-30', familyId);
    expect(await dates()).toEqual(['2027-01-31', '2027-05-31', '2027-06-30']);
  });

  it('on resume, moves generateFrom to today so the paused period is skipped', async () => {
    const rule = (await call('POST', '/api/recurring', rent({ backfill: true }))).json().data; // back-filled up to today
    const before = await prisma.transaction.count();
    await call('PUT', `/api/recurring/${rule.id}`, { active: false });
    await call('PUT', `/api/recurring/${rule.id}`, { active: true });
    const r = await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(r.generateFrom.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    expect(await prisma.transaction.count()).toBe(before);
  });
});

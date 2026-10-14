import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { monthRange, previousMonth } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { listCategories } from './categoryService.js';
import { assertAccount } from './ownership.js';

const cents = z
  .number()
  .int('Amount must be in whole cents')
  .positive()
  .refine(Number.isSafeInteger);
export const MonthEntryInput = z.object({
  accountId: z.uuid(),
  entries: z.array(z.object({ categoryId: z.uuid(), amount: cents.nullable() })).max(500),
});
export const MonthEntryQuery = z.object({ accountId: z.uuid() });

export async function getMonthEntry(
  prisma: PrismaClient,
  familyId: string,
  month: string,
  accountId: string,
) {
  const account = await assertAccount(prisma, familyId, accountId);
  const { start, end } = monthRange(month);
  const inMonth = { familyId, date: { gte: start, lt: end } };
  // The three months before, for "last month" and "usual" suggestions.
  const before = [previousMonth(month)];
  before.push(previousMonth(before[0]!), previousMonth(previousMonth(before[0]!)));
  const [categories, totals, individual, history] = await Promise.all([
    listCategories(prisma, familyId),
    prisma.transaction.findMany({
      where: { ...inMonth, accountId, isMonthlyTotal: true },
      select: { categoryId: true, amount: true },
    }),
    prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...inMonth, isMonthlyTotal: false },
      _count: { _all: true },
    }),
    prisma.transaction.findMany({
      where: {
        familyId,
        type: { in: ['income', 'expense'] },
        date: { gte: monthRange(before[2]!).start, lt: start },
      },
      select: {
        date: true,
        categoryId: true,
        amount: true,
        currency: true,
        accountId: true,
        isMonthlyTotal: true,
        recurringRuleId: true,
      },
    }),
  ]);
  // What this grid could have held: money in this account's currency, but not other accounts'
  // own grids (each keeps its totals) and not recurring payments (they are added by themselves).
  const relevant = history.filter(
    (t) =>
      t.currency === account.currency &&
      !(t.isMonthlyTotal && t.accountId !== accountId) &&
      t.recurringRuleId === null,
  );
  // A month counts towards the usual once any of that money was recorded in it.
  const recorded = new Set(relevant.map((t) => t.date.toISOString().slice(0, 7)));
  const past = new Map<string, number>(); // "month|categoryId" → total
  for (const t of relevant) {
    if (!t.categoryId) continue;
    const key = `${t.date.toISOString().slice(0, 7)}|${t.categoryId}`;
    past.set(key, (past.get(key) ?? 0) + Number(t.amount));
  }
  const usualMonths = before.filter((m) => recorded.has(m));
  const suggest = (categoryId: string) => {
    const last = past.get(`${before[0]}|${categoryId}`) ?? 0;
    const usual = usualMonths.length
      ? Math.round(
          usualMonths.reduce((s, m) => s + (past.get(`${m}|${categoryId}`) ?? 0), 0) /
            usualMonths.length,
        )
      : 0;
    return { lastMonth: last > 0 ? last : null, usual: usual > 0 ? usual : null };
  };
  const amount = new Map(totals.map((t) => [t.categoryId, Number(t.amount)]));
  const count = new Map(individual.map((g) => [g.categoryId, g._count._all]));
  return {
    month,
    accountId,
    currency: account.currency,
    rows: categories.map((c) => ({
      categoryId: c.id,
      name: c.name,
      kind: c.kind,
      bucket: c.bucket,
      amount: amount.get(c.id) ?? null,
      otherTransactions: count.get(c.id) ?? 0,
      ...suggest(c.id),
    })),
  };
}

/** Upserts (amount) or deletes (null) the one monthly-total transaction per category. */
export async function saveMonthEntry(
  prisma: PrismaClient,
  familyId: string,
  month: string,
  { accountId, entries }: z.output<typeof MonthEntryInput>,
) {
  const account = await assertAccount(prisma, familyId, accountId);
  if (account.archived) {
    throw new AppError(400, 'ACCOUNT_ARCHIVED', 'Choose an active account for monthly totals');
  }
  const ids = [...new Set(entries.map((e) => e.categoryId))];
  const categories = await prisma.category.findMany({ where: { familyId, id: { in: ids } } });
  if (categories.length !== ids.length) throw notFound('Category');
  const kind = new Map(categories.map((c) => [c.id, c.kind]));

  const { start, end } = monthRange(month);
  await prisma.$transaction(async (tx) => {
    for (const { categoryId, amount } of entries) {
      const where = {
        familyId,
        accountId,
        categoryId,
        isMonthlyTotal: true,
        date: { gte: start, lt: end },
      };
      const existing = await tx.transaction.findFirst({ where, select: { id: true } });
      if (amount === null) {
        if (existing) await tx.transaction.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.transaction.update({ where: { id: existing.id }, data: { amount } });
      } else {
        await tx.transaction.create({
          data: {
            familyId,
            accountId,
            categoryId,
            amount,
            currency: account.currency,
            type: kind.get(categoryId)!,
            date: start,
            notes: 'Monthly total',
            isMonthlyTotal: true,
          },
        });
      }
    }
  });
  return getMonthEntry(prisma, familyId, month, accountId);
}

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { monthRange } from '../lib/dates.js';
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
  const [categories, totals, individual] = await Promise.all([
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
  ]);
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

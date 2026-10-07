import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { summarizeMonth, type Bucket, type SummaryTxn } from '../domain/budget.js';
import { MONTH_RE, monthRange, previousMonth } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { listCategories } from './categoryService.js';
import { getFamily } from './familyService.js';

export const MonthParams = z.object({
  month: z.string().regex(MONTH_RE, 'Use a month as YYYY-MM'),
});

const cents = z
  .number()
  .int('Amount must be in whole cents')
  .positive()
  .refine(Number.isSafeInteger);
export const LimitsInput = z.object({
  limits: z.array(z.object({ categoryId: z.uuid(), amount: cents.nullable() })).max(500),
});

export async function getSummary(prisma: PrismaClient, familyId: string, month: string) {
  const { start, end } = monthRange(month);
  const [family, txns, rates, limits, categories] = await Promise.all([
    getFamily(prisma, familyId),
    prisma.transaction.findMany({
      where: { familyId, date: { gte: start, lt: end } },
      select: {
        type: true,
        amount: true,
        isMonthlyTotal: true,
        categoryId: true,
        account: { select: { currency: true } },
        category: { select: { name: true, bucket: true } },
      },
    }),
    prisma.exchangeRate.findMany({
      where: { familyId },
      select: { month: true, base: true, quote: true, rateMicros: true },
    }),
    prisma.categoryLimit.findMany({ where: { familyId, month } }),
    listCategories(prisma, familyId),
  ]);
  return summarizeMonth({
    month,
    currency: family.spendingCurrency,
    targets: family.targets,
    rates,
    categories,
    limits: limits.map((l) => ({ categoryId: l.categoryId, amount: Number(l.amount) })),
    txns: txns.map((t): SummaryTxn => ({
      type: t.type as SummaryTxn['type'],
      amount: Number(t.amount),
      currency: t.account.currency,
      categoryId: t.categoryId,
      categoryName: t.category?.name ?? null,
      bucket: (t.category?.bucket ?? null) as Bucket | null,
      isMonthlyTotal: t.isMonthlyTotal,
    })),
  });
}

export async function setLimits(
  prisma: PrismaClient,
  familyId: string,
  month: string,
  { limits }: z.output<typeof LimitsInput>,
) {
  const ids = [...new Set(limits.map((l) => l.categoryId))];
  const found = await prisma.category.findMany({ where: { familyId, id: { in: ids } } });
  if (found.length !== ids.length) throw notFound('Category');
  if (found.some((c) => c.kind !== 'expense')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
      { path: 'limits', message: 'Limits apply to expense categories only' },
    ]);
  }
  await prisma.$transaction(
    limits.map(({ categoryId, amount }) =>
      amount === null
        ? prisma.categoryLimit.deleteMany({ where: { familyId, month, categoryId } })
        : prisma.categoryLimit.upsert({
            where: { familyId_month_categoryId: { familyId, month, categoryId } },
            create: { familyId, month, categoryId, amount },
            update: { amount },
          }),
    ),
  );
  return getSummary(prisma, familyId, month);
}

export async function copyPreviousLimits(prisma: PrismaClient, familyId: string, month: string) {
  const previous = await prisma.categoryLimit.findMany({
    where: { familyId, month: previousMonth(month) },
  });
  if (previous.length === 0) {
    throw new AppError(409, 'NO_PREVIOUS_LIMITS', 'Last month has no category limits to copy');
  }
  await prisma.$transaction([
    prisma.categoryLimit.deleteMany({ where: { familyId, month } }),
    prisma.categoryLimit.createMany({
      data: previous.map((l) => ({ familyId, month, categoryId: l.categoryId, amount: l.amount })),
    }),
  ]);
  return getSummary(prisma, familyId, month);
}

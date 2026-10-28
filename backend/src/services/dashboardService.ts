import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadRates } from './rateService.js';
import type { Bucket } from '../domain/budget.js';
import { buildDashboard, monthsBetween, type DashboardTxn } from '../domain/dashboard.js';
import { CurrencySchema, sumConverted } from '../domain/currency.js';
import { MONTH_RE, monthRange, todayLocal } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { listAccounts } from './accountService.js';
import { listCategories } from './categoryService.js';
import { getFamily } from './familyService.js';

export const DashboardQuery = z.object({
  from: z.string().regex(MONTH_RE, 'Use a month as YYYY-MM'),
  to: z.string().regex(MONTH_RE, 'Use a month as YYYY-MM'),
  currency: CurrencySchema.optional(),
});

export async function getDashboard(
  prisma: PrismaClient,
  familyId: string,
  from: string,
  to: string,
  view?: string,
) {
  let length: number;
  try {
    length = monthsBetween(from, to).length;
  } catch (e) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid period', [
      { path: 'from', message: (e as Error).message },
    ]);
  }
  // Load the period plus the preceding period of the same length (for comparisons).
  const start = monthRange(from).start;
  start.setUTCMonth(start.getUTCMonth() - length);
  const end = monthRange(to).end;

  const [family, rows, rates, categories, members, accounts, first, uncategorised] =
    await Promise.all([
      getFamily(prisma, familyId),
      prisma.transaction.findMany({
        where: { familyId, date: { gte: start, lt: end } },
        select: {
          date: true,
          type: true,
          amount: true,
          isMonthlyTotal: true,
          categoryId: true,
          memberId: true,
          currency: true,
          category: { select: { name: true, bucket: true } },
        },
      }),
      loadRates(prisma, familyId),
      listCategories(prisma, familyId),
      prisma.familyMember.findMany({ where: { familyId }, select: { id: true, name: true } }),
      listAccounts(prisma, familyId),
      prisma.transaction.findFirst({
        where: { familyId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      // the period's income and payments without a category: how many, and the newest
      prisma.transaction.aggregate({
        where: {
          familyId,
          // the period itself, not the one before it (loaded for the comparison)
          date: { gte: monthRange(from).start, lt: end },
          type: { in: ['income', 'expense'] },
          categoryId: null,
        },
        _count: true,
        _max: { date: true },
      }),
    ]);

  const dashboard = buildDashboard({
    from,
    to,
    currency: view ?? family.spendingCurrency,
    targets: family.targets,
    rates,
    categories,
    members,
    txns: rows.map((t): DashboardTxn => ({
      month: t.date.toISOString().slice(0, 7),
      type: t.type as DashboardTxn['type'],
      amount: Number(t.amount),
      currency: t.currency,
      categoryId: t.categoryId,
      categoryName: t.category?.name ?? null,
      bucket: (t.category?.bucket ?? null) as Bucket | null,
      isMonthlyTotal: t.isMonthlyTotal,
      memberId: t.memberId,
    })),
  });

  const currency = view ?? family.spendingCurrency;
  const now = todayLocal().slice(0, 7);
  // bank accounts only: demat and broker accounts hold investments, counted on their own
  const live = accounts.filter((a) => !a.archived && a.type !== 'investment');
  const balances = new Map<string, number>();
  for (const a of live) balances.set(a.currency, (balances.get(a.currency) ?? 0) + a.balance);
  return {
    ...dashboard,
    targets: family.targets,
    accountsTotal: {
      currency,
      ...sumConverted(
        live.map((a) => ({ amount: a.balance, currency: a.currency, month: now })),
        currency,
        rates,
      ),
    },
    firstMonth: first ? first.date.toISOString().slice(0, 7) : null,
    /** income and payments of the period without a category (to sort out), and the month of
     * the newest (where the list of them opens) */
    uncategorised: {
      count: uncategorised._count,
      latestMonth: uncategorised._max.date?.toISOString().slice(0, 7) ?? null,
    },
    accounts: [...balances]
      .map(([currency, balance]) => ({ currency, balance }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

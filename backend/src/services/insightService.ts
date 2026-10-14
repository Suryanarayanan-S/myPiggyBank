import type { PrismaClient } from '@prisma/client';
import type { Bucket } from '../domain/budget.js';
import { convert } from '../domain/currency.js';
import { findInsights, type InsightTxn } from '../domain/insights.js';
import { monthRange, todayLocal } from '../lib/dates.js';
import { listCategories } from './categoryService.js';
import { getFamily } from './familyService.js';
import { listGoals } from './goalService.js';
import { listHoldings } from './holdingService.js';
import { loadRates } from './rateService.js';

const addMonths = (month: string, n: number) => {
  const { start } = monthRange(month);
  start.setUTCMonth(start.getUTCMonth() + n);
  return start.toISOString().slice(0, 7);
};

/** Observations for this month and the six full months before, in one currency. */
export async function getInsights(prisma: PrismaClient, familyId: string, view?: string) {
  const today = todayLocal();
  const current = today.slice(0, 7);
  const first = addMonths(current, -6);
  const [family, rates, categories, rows, limits, goals, holdings] = await Promise.all([
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    listCategories(prisma, familyId),
    prisma.transaction.findMany({
      where: {
        familyId,
        type: { in: ['income', 'expense'] },
        date: { gte: monthRange(first).start, lt: monthRange(current).end },
      },
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        isMonthlyTotal: true,
        importBatch: true,
        merchant: true,
        categoryId: true,
        currency: true,
        category: { select: { bucket: true } },
      },
    }),
    prisma.categoryLimit.findMany({ where: { familyId, month: { gte: first, lte: current } } }),
    listGoals(prisma, familyId),
    listHoldings(prisma, familyId, view),
  ]);
  const currency = view ?? family.spendingCurrency;
  const unconverted = new Map<string, number>();
  const txns: InsightTxn[] = [];
  let unconvertedLimits = 0;
  for (const t of rows) {
    // Later days of this month count for its limits (as on the budget page); the insights that
    // look at single payments only use those up to today.
    const date = t.date.toISOString().slice(0, 10);
    const amount = convert(Number(t.amount), t.currency, currency, date.slice(0, 7), rates);
    if (amount === null) {
      unconverted.set(t.currency, (unconverted.get(t.currency) ?? 0) + Number(t.amount));
      continue;
    }
    txns.push({
      id: t.id,
      date,
      type: t.type as InsightTxn['type'],
      amount,
      categoryId: t.categoryId,
      bucket: (t.category?.bucket ?? null) as Bucket | null,
      merchant: t.merchant,
      // Spreadsheet rows are monthly totals too (one per category and month), not payments.
      isMonthlyTotal: t.isMonthlyTotal || (t.importBatch?.startsWith('xlsx:') ?? false),
    });
  }
  const insights = findInsights({
    today,
    categories: categories.map((c) => ({ id: c.id, name: c.name, bucket: c.bucket })),
    txns,
    limits: limits.flatMap((l) => {
      const amount = convert(Number(l.amount), l.currency, currency, l.month, rates);
      if (amount === null) unconvertedLimits++;
      return amount === null ? [] : [{ month: l.month, categoryId: l.categoryId, amount }];
    }),
    goals,
    holdings: holdings.holdings,
  });
  return {
    currency,
    insights,
    unconverted: [...unconverted].map(([c, amount]) => ({ currency: c, amount })),
    /** budget limits that could not be compared (no exchange rate) */
    unconvertedLimits,
  };
}

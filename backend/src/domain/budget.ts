import { convert, type Rate } from './currency.js';

export type Bucket = 'essentials' | 'fun' | 'future';
const BUCKETS: Bucket[] = ['essentials', 'fun', 'future'];

export type SummaryTxn = {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  bucket: Bucket | null;
  isMonthlyTotal: boolean;
};

export type Targets = Record<Bucket, number>;

type CategoryInfo = { id: string; name: string; kind: string; bucket: Bucket | null };

export type MonthSummary = ReturnType<typeof summarizeMonth>;

/** Basis points (1 bp = 0.01 %) of part/whole, or null when whole is 0. */
const bp = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);

/**
 * All money math for one month, in `currency` (the family's spending currency).
 * Amounts in other currencies are converted with the month's rate; when no rate exists they are
 * excluded from every total and reported in `unconverted` — never added 1:1.
 */
export function summarizeMonth(input: {
  month: string;
  currency: string;
  txns: SummaryTxn[];
  rates: Rate[];
  targets: Targets;
  limits: { categoryId: string; amount: number }[];
  categories: CategoryInfo[];
}) {
  const byCategory = new Map<string | null, number>();
  const unconverted = new Map<string, number>();
  const totals = { income: 0, essentials: 0, fun: 0, future: 0, uncategorised: 0 };

  for (const t of input.txns) {
    if (t.type === 'transfer') continue;
    const amount = convert(t.amount, t.currency, input.currency, input.month, input.rates);
    if (amount === null) {
      unconverted.set(t.currency, (unconverted.get(t.currency) ?? 0) + t.amount);
      continue;
    }
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + amount);
    if (t.type === 'income') totals.income += amount;
    else if (t.bucket) totals[t.bucket] += amount;
    else totals.uncategorised += amount;
  }

  const netIncome = totals.income;
  const spent = totals.essentials + totals.fun + totals.uncategorised;
  const unused = netIncome - spent - totals.future;

  const buckets = BUCKETS.map((bucket) => {
    const targetPct = input.targets[bucket];
    const target = Math.round((netIncome * targetPct) / 100);
    const actual = totals[bucket];
    const status =
      bucket === 'future' ? (actual < target ? 'under' : 'ok') : actual > target ? 'over' : 'ok';
    return { bucket, targetPct, target, actual, actualBp: bp(actual, netIncome), status };
  });

  const limits = new Map(input.limits.map((l) => [l.categoryId, l.amount]));
  const order = (c: CategoryInfo) => (c.kind === 'income' ? 0 : 1 + BUCKETS.indexOf(c.bucket!));
  const categories = [...input.categories]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => order(a.c) - order(b.c) || a.i - b.i)
    .map(({ c }) => {
      const actual = byCategory.get(c.id) ?? 0;
      const limit = limits.get(c.id) ?? null;
      return {
        categoryId: c.id as string | null,
        name: c.name,
        kind: c.kind,
        bucket: c.bucket,
        actual,
        limit,
        remaining: limit === null ? null : limit - actual,
        usedBp: limit === null ? null : bp(actual, limit),
        over: limit !== null && actual > limit,
      };
    });
  if (totals.uncategorised > 0) {
    categories.push({
      categoryId: null,
      name: 'Uncategorised',
      kind: 'expense',
      bucket: null,
      actual: totals.uncategorised,
      limit: null,
      remaining: null,
      usedBp: null,
      over: false,
    });
  }

  return {
    month: input.month,
    currency: input.currency,
    netIncome,
    essentials: totals.essentials,
    fun: totals.fun,
    future: totals.future,
    uncategorised: totals.uncategorised,
    spent,
    unused,
    savingsRateBp: bp(totals.future + unused, netIncome),
    buckets,
    categories,
    unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount })),
  };
}

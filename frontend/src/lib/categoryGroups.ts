import { BUCKETS, type Bucket, type CategorySummary } from './types';

export type GroupedCategory = CategorySummary & { shareBp: number };
export type CategoryGroup = {
  bucket: Bucket;
  total: number;
  /** Spending or a limit this month, largest amount first. */
  shown: GroupedCategory[];
  /** No spending and no limit — folded away until asked for. */
  hidden: CategorySummary[];
};

/** Expense categories per bucket, in bucket order; uncategorised spending is not in any bucket. */
export function groupCategories(categories: CategorySummary[]): CategoryGroup[] {
  return (Object.keys(BUCKETS) as Bucket[]).map((bucket) => {
    const rows = categories.filter((c) => c.kind === 'expense' && c.bucket === bucket);
    const total = rows.reduce((sum, c) => sum + c.actual, 0);
    return {
      bucket,
      total,
      shown: rows
        .filter((c) => c.actual > 0 || c.limit !== null)
        .sort((a, b) => b.actual - a.actual)
        .map((c) => ({ ...c, shareBp: total > 0 ? Math.round((c.actual / total) * 10_000) : 0 })),
      hidden: rows.filter((c) => c.actual === 0 && c.limit === null),
    };
  });
}

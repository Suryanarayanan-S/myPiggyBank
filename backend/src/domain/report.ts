import type { Bucket } from './budget.js';

const MONEY = [
  'netIncome',
  'essentials',
  'fun',
  'future',
  'uncategorised',
  'spent',
  'unused',
] as const;
type MoneyKey = (typeof MONEY)[number];
type Money = Record<MoneyKey, number> & { savingsRateBp: number | null };

/** What the dashboard maths gives for one period (a year here). */
export type PeriodNumbers = {
  months: ({ month: string } & Money)[];
  totals: Money;
  categories: { categoryId: string | null; name: string; bucket: Bucket | null; actual: number }[];
  members: { memberId: string | null; name: string; actual: number }[];
};

const changeBp = (now: number, before: number) =>
  before === 0 ? null : Math.round(((now - before) * 10_000) / Math.abs(before));
const isRecorded = (m: Money) =>
  m.netIncome !== 0 || m.essentials !== 0 || m.fun !== 0 || m.future !== 0 || m.uncategorised !== 0;

/** Merges rows of both years by id; a row only in one year shows 0 in the other. */
function merge<K extends string | null, R extends { name: string; actual: number }>(
  now: R[],
  before: R[],
  key: (r: R) => K,
) {
  const rows = new Map<K, R & { previous: number }>();
  for (const r of now) rows.set(key(r), { ...r, previous: 0 });
  for (const r of before) {
    const row = rows.get(key(r));
    if (row) row.previous = r.actual;
    else rows.set(key(r), { ...r, actual: 0, previous: r.actual });
  }
  return [...rows.values()]
    .map((r) => ({ ...r, changeBp: changeBp(r.actual, r.previous) }))
    .sort((a, b) => b.actual - a.actual || b.previous - a.previous || a.name.localeCompare(b.name));
}

/** A year next to the year before: recorded months, averages, changes, categories and people. */
export function yearReport(current: PeriodNumbers, previous: PeriodNumbers) {
  const months = current.months.map((m) => ({ ...m, recorded: isRecorded(m) }));
  const recordedMonths = months.filter((m) => m.recorded).length;
  const previousRecorded = previous.months.filter(isRecorded).length;
  const averages = Object.fromEntries(
    MONEY.map((k) => [k, recordedMonths ? Math.round(current.totals[k] / recordedMonths) : 0]),
  ) as Record<MoneyKey, number>;
  const change = Object.fromEntries(
    MONEY.map((k) => [
      k,
      {
        amount: current.totals[k] - previous.totals[k],
        bp: changeBp(current.totals[k], previous.totals[k]),
      },
    ]),
  ) as Record<MoneyKey, { amount: number; bp: number | null }>;
  return {
    months,
    totals: current.totals,
    recordedMonths,
    averages: { ...averages, savingsRateBp: current.totals.savingsRateBp },
    previous: previousRecorded
      ? { totals: previous.totals, recordedMonths: previousRecorded }
      : null,
    change,
    categories: merge(current.categories, previous.categories, (c) => c.categoryId),
    members: merge(current.members, previous.members, (m) => m.memberId),
  };
}

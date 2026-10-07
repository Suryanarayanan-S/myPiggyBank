import { summarizeMonth, type Bucket, type SummaryTxn, type Targets } from './budget.js';
import { convert, type Rate } from './currency.js';

export const MAX_MONTHS = 120;
export type DashboardTxn = SummaryTxn & { month: string; memberId: string | null };

const shift = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/** Every "YYYY-MM" from `from` to `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  if (from > to) throw new RangeError('from must not be after to');
  const out: string[] = [];
  for (let m = from; m <= to; m = shift(m, 1)) {
    out.push(m);
    if (out.length > MAX_MONTHS) throw new RangeError(`at most ${MAX_MONTHS} months`);
  }
  return out;
}

const bp = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);
const MONEY = [
  'netIncome',
  'essentials',
  'fun',
  'future',
  'uncategorised',
  'spent',
  'unused',
] as const;
type Money = Record<(typeof MONEY)[number], number>;

function withRates(m: Money) {
  return {
    ...m,
    savingsRateBp: bp(m.future + m.unused, m.netIncome),
    sharesBp: {
      essentials: bp(m.essentials, m.netIncome),
      fun: bp(m.fun, m.netIncome),
      future: bp(m.future, m.netIncome),
    },
  };
}

export function buildDashboard(input: {
  from: string;
  to: string;
  currency: string;
  txns: DashboardTxn[];
  rates: Rate[];
  targets: Targets;
  categories: { id: string; name: string; kind: string; bucket: Bucket | null }[];
  members: { id: string; name: string }[];
}) {
  const range = monthsBetween(input.from, input.to);
  const previousRange = monthsBetween(shift(input.from, -range.length), shift(input.from, -1));

  const summarize = (month: string) =>
    summarizeMonth({
      month,
      currency: input.currency,
      txns: input.txns.filter((t) => t.month === month),
      rates: input.rates,
      targets: input.targets,
      limits: [],
      categories: input.categories,
    });
  const total = (summaries: ReturnType<typeof summarize>[]) =>
    withRates(
      Object.fromEntries(MONEY.map((k) => [k, summaries.reduce((s, x) => s + x[k], 0)])) as Money,
    );

  const summaries = range.map(summarize);
  // Compare only with a previous period in which every month has income or expenses recorded;
  // a partly recorded one would produce claims like "+342 % spending".
  const recorded = new Set(
    input.txns
      .filter((t) => t.type !== 'transfer' && t.month >= previousRange[0]! && t.month < input.from)
      .map((t) => t.month),
  );
  const previousCoverage = { recorded: recorded.size, months: previousRange.length };

  const categories = new Map<
    string | null,
    { categoryId: string | null; name: string; bucket: Bucket | null; actual: number }
  >();
  for (const c of summaries.flatMap((s) => s.categories)) {
    if (c.kind !== 'expense' || c.actual === 0) continue;
    const entry = categories.get(c.categoryId) ?? {
      categoryId: c.categoryId,
      name: c.name,
      bucket: c.bucket,
      actual: 0,
    };
    entry.actual += c.actual;
    categories.set(c.categoryId, entry);
  }

  // Spending by member: what was spent (essentials, fun, uncategorised) — Future You is saving.
  const memberName = new Map(input.members.map((m) => [m.id, m.name]));
  const members = new Map<
    string | null,
    { memberId: string | null; name: string; actual: number }
  >();
  for (const t of input.txns) {
    if (t.type !== 'expense' || t.bucket === 'future' || t.month < input.from || t.month > input.to)
      continue;
    const amount = convert(t.amount, t.currency, input.currency, t.month, input.rates);
    if (amount === null) continue;
    const entry = members.get(t.memberId) ?? {
      memberId: t.memberId,
      name: t.memberId ? (memberName.get(t.memberId) ?? 'Former member') : 'Shared',
      actual: 0,
    };
    entry.actual += amount;
    members.set(t.memberId, entry);
  }

  const unconverted = new Map<string, number>();
  for (const u of summaries.flatMap((s) => s.unconverted)) {
    unconverted.set(u.currency, (unconverted.get(u.currency) ?? 0) + u.amount);
  }

  const byActual = <T extends { actual: number; name: string }>(a: T, b: T) =>
    b.actual - a.actual || a.name.localeCompare(b.name);

  return {
    from: input.from,
    to: input.to,
    currency: input.currency,
    months: summaries.map((s) => ({
      month: s.month,
      ...withRates({
        netIncome: s.netIncome,
        essentials: s.essentials,
        fun: s.fun,
        future: s.future,
        uncategorised: s.uncategorised,
        spent: s.spent,
        unused: s.unused,
      }),
    })),
    totals: total(summaries),
    previous: recorded.size === previousRange.length ? total(previousRange.map(summarize)) : null,
    previousCoverage,
    categories: [...categories.values()].sort(byActual),
    members: [...members.values()].sort(byActual),
    unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount })),
  };
}

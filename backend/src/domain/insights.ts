import type { Bucket } from './budget.js';

/**
 * Observations computed from the family's own numbers — never advice. The server decides what
 * is worth saying and the numbers behind it; the frontend writes the sentence.
 * All thresholds live here so they can be read (and tuned) in one place.
 */
export const THRESHOLDS = {
  /** rising: each month-to-month step at least this share and this amount (minor units) */
  risingStepBp: 500,
  risingStepMin: 1_000,
  /** vsAverage: last full month this far from the average of the five before */
  vsAverageBp: 3_000,
  vsAverageMin: 5_000,
  /** months with spending needed to call something "usual" */
  usualMonths: 3,
  /** subscription: in this many of the last 4 full months, amounts within this share of the median */
  subscriptionMonths: 3,
  subscriptionSpreadBp: 1_000,
  /** at most this many regular payments are listed (the largest) */
  subscriptionMax: 5,
  /** more payments than this in a month is shopping, not a regular payment */
  subscriptionPerMonth: 2,
  /** savings trend: average rate of the last 3 vs the 3 before, in basis points */
  savingsTrendBp: 300,
  /** holdings: biggest gain/loss shown when at least this return */
  holdingBp: 500,
  /** large: a payment this many times its category's median, with this many earlier payments */
  largeTimes: 3,
  largeMinRows: 5,
  largeMin: 5_000,
  largeDays: 30,
} as const;
const T = THRESHOLDS;

export type InsightTxn = {
  id: string;
  date: string;
  type: 'income' | 'expense';
  /** in the report currency (amounts without a rate are left out before this) */
  amount: number;
  categoryId: string | null;
  bucket: Bucket | null;
  merchant: string | null;
  /** quick-entry / spreadsheet monthly totals are not single payments */
  isMonthlyTotal: boolean;
};
export type InsightInput = {
  today: string;
  categories: { id: string; name: string; bucket: Bucket | null }[];
  /** the current month and the six full months before it */
  txns: InsightTxn[];
  limits: { month: string; categoryId: string; amount: number }[];
  goals: {
    id: string;
    name: string;
    currency: string;
    status: string;
    progress: {
      onTrack: boolean | null;
      overdue: boolean;
      monthlyNeeded: number | null;
      pace: number;
      left: number;
    };
  }[];
  holdings: {
    id: string;
    name: string;
    currency: string;
    archived: boolean;
    value: number | null;
    unrealised: number | null;
    returnBp: number | null;
  }[];
};

export type Tone = 'warning' | 'info' | 'good';
export type Insight = {
  id: string;
  kind:
    | 'rising'
    | 'vsAverage'
    | 'overLimit'
    | 'subscription'
    | 'savingsTrend'
    | 'goalBehind'
    | 'holding'
    | 'large';
  tone: Tone;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- per kind, read by insightText
  data: Record<string, any>;
  link: string;
  /** how big it is, for ordering among insights of the same kind */
  size: number;
};

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};
const bp = (part: number, whole: number) => Math.round((part * 10_000) / whole);
const TONE_ORDER: Record<Tone, number> = { warning: 0, info: 1, good: 2 };
/** Within a tone: what matters now first (sizes of different kinds are not comparable). */
const KIND_ORDER: Record<Insight['kind'], number> = {
  overLimit: 0,
  goalBehind: 1,
  savingsTrend: 2,
  rising: 3,
  vsAverage: 4,
  large: 5,
  holding: 6,
  subscription: 7,
};

export function findInsights(input: InsightInput): Insight[] {
  const current = input.today.slice(0, 7);
  const full = Array.from({ length: 6 }, (_, i) => addMonths(current, i - 6)); // oldest first
  const last = full[5]!;
  const name = new Map(input.categories.map((c) => [c.id, c.name]));
  const bucket = new Map(input.categories.map((c) => [c.id, c.bucket]));
  const expenses = input.txns.filter((t) => t.type === 'expense' && t.categoryId);
  // Spending per category and month.
  const spent = new Map<string, Map<string, number>>();
  for (const t of expenses) {
    const m = spent.get(t.categoryId!) ?? new Map<string, number>();
    m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + t.amount);
    spent.set(t.categoryId!, m);
  }
  const amountIn = (cat: string, month: string) => spent.get(cat)?.get(month) ?? 0;
  const out: Insight[] = [];
  // Spending more is a warning, except for Future You (saving more is good).
  const upTone = (cat: string): Tone => (bucket.get(cat) === 'future' ? 'good' : 'warning');
  const downTone = (cat: string): Tone => (bucket.get(cat) === 'future' ? 'warning' : 'good');

  // rising: three full months in a row, each step big enough
  for (const cat of spent.keys()) {
    const a = full.slice(3).map((m) => amountIn(cat, m));
    const step = (x: number, y: number) =>
      x > 0 && y - x >= T.risingStepMin && bp(y - x, x) >= T.risingStepBp;
    if (step(a[0]!, a[1]!) && step(a[1]!, a[2]!)) {
      out.push({
        id: `rising:${cat}`,
        kind: 'rising',
        tone: upTone(cat),
        data: { category: name.get(cat), amounts: a, months: full.slice(3) },
        link: `/budget?month=${last}`,
        size: a[2]! - a[0]!,
      });
    }
  }

  // vsAverage: the one category furthest from its usual (average of the five months before,
  // empty months included; at least three of them with spending) in the last full month
  let best: Insight | null = null;
  for (const cat of spent.keys()) {
    const before = full.slice(0, 5).map((m) => amountIn(cat, m));
    if (before.filter((x) => x > 0).length < T.usualMonths) continue;
    const usual = Math.round(before.reduce((sum, x) => sum + x, 0) / before.length);
    const amount = amountIn(cat, last);
    const diff = amount - usual;
    if (Math.abs(diff) < T.vsAverageMin || Math.abs(bp(diff, usual)) < T.vsAverageBp) continue;
    if (!best || Math.abs(diff) > best.size) {
      best = {
        id: `vsAverage:${cat}`,
        kind: 'vsAverage',
        tone: diff > 0 ? upTone(cat) : downTone(cat),
        data: { category: name.get(cat), month: last, amount, usual, bp: bp(diff, usual) },
        link: `/budget?month=${last}`,
        size: Math.abs(diff),
      };
    }
  }
  if (best) out.push(best);

  // overLimit: this month (all of it, as on the budget page), and how often in the six before
  for (const l of input.limits.filter((x) => x.month === current)) {
    const actual = amountIn(l.categoryId, current);
    if (actual <= l.amount) continue;
    const pastMonthsOver = input.limits.filter(
      (x) =>
        x.categoryId === l.categoryId &&
        full.includes(x.month) &&
        amountIn(l.categoryId, x.month) > x.amount,
    ).length;
    out.push({
      id: `overLimit:${l.categoryId}`,
      kind: 'overLimit',
      tone: 'warning',
      data: { category: name.get(l.categoryId), over: actual - l.amount, pastMonthsOver },
      link: `/budget?month=${current}`,
      size: actual - l.amount,
    });
  }

  // regular payments: the same merchant about once a month, for a similar amount
  const single = expenses.filter((t) => !t.isMonthlyTotal && t.date <= input.today);
  const byMerchant = new Map<string, { label: string; months: Map<string, number[]> }>();
  for (const t of single) {
    const month = t.date.slice(0, 7);
    if (!t.merchant?.trim() || !full.slice(2).includes(month)) continue;
    const key = t.merchant.trim().toLowerCase();
    const e = byMerchant.get(key) ?? { label: t.merchant.trim(), months: new Map() };
    e.months.set(month, [...(e.months.get(month) ?? []), t.amount]);
    byMerchant.set(key, e);
  }
  const regular: Insight[] = [];
  for (const [key, e] of byMerchant) {
    const perMonth = [...e.months.values()];
    if (perMonth.length < T.subscriptionMonths) continue;
    if (perMonth.some((payments) => payments.length > T.subscriptionPerMonth)) continue;
    const amounts = perMonth.map((payments) => payments.reduce((sum, x) => sum + x, 0));
    const monthly = median(amounts);
    if (amounts.some((a) => Math.abs(bp(a - monthly, monthly)) > T.subscriptionSpreadBp)) continue;
    regular.push({
      id: `subscription:${key}`,
      kind: 'subscription',
      tone: 'info',
      data: { merchant: e.label, monthly, yearly: monthly * 12 },
      link: `/transactions?month=${last}&q=${encodeURIComponent(e.label)}`,
      size: monthly * 12,
    });
  }
  out.push(...regular.sort((a, b) => b.size - a.size).slice(0, T.subscriptionMax));

  // savingsTrend: Σ(income − essentials − fun − uncategorised) / Σincome over each three
  // months (the budget's savings rate), so a month with little income weighs little
  const windowRate = (months: string[]) => {
    const inWindow = input.txns.filter((t) => months.includes(t.date.slice(0, 7)));
    const income = inWindow
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    if (income <= 0) return null;
    const spentNow = inWindow
      .filter((t) => t.type === 'expense' && t.bucket !== 'future')
      .reduce((sum, t) => sum + t.amount, 0);
    return bp(income - spentNow, income);
  };
  const earlierBp = windowRate(full.slice(0, 3));
  const recentBp = windowRate(full.slice(3));
  if (
    earlierBp !== null &&
    recentBp !== null &&
    Math.abs(recentBp - earlierBp) >= T.savingsTrendBp
  ) {
    out.push({
      id: 'savingsTrend',
      kind: 'savingsTrend',
      tone: recentBp > earlierBp ? 'good' : 'warning',
      data: { recentBp, earlierBp },
      link: `/reports`,
      size: Math.abs(recentBp - earlierBp),
    });
  }

  // goalBehind
  for (const g of input.goals) {
    if (g.status !== 'active' || (g.progress.onTrack !== false && !g.progress.overdue)) continue;
    out.push({
      id: `goal:${g.id}`,
      kind: 'goalBehind',
      tone: 'warning',
      data: { name: g.name, currency: g.currency, ...g.progress },
      link: '/goals',
      size: g.progress.left,
    });
  }

  // holding: the biggest gain and the biggest loss
  const open = input.holdings.filter(
    (h) => !h.archived && h.value && h.returnBp !== null && Math.abs(h.returnBp) >= T.holdingBp,
  );
  const sorted = [...open].sort((a, b) => b.returnBp! - a.returnBp!);
  const gain = sorted.find((h) => h.returnBp! > 0);
  const lowest = sorted.at(-1);
  const loss = lowest && lowest.returnBp! < 0 ? lowest : undefined;
  for (const h of [gain, loss]) {
    if (!h) continue;
    out.push({
      id: `holding:${h.id}`,
      kind: 'holding',
      tone: h.returnBp! > 0 ? 'good' : 'warning',
      data: { name: h.name, currency: h.currency, returnBp: h.returnBp, unrealised: h.unrealised },
      link: '/investments',
      size: Math.abs(h.returnBp!),
    });
  }

  // large: a recent single payment far above its category's usual payment
  const recentFrom = (() => {
    const d = new Date(`${input.today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - T.largeDays);
    return d.toISOString().slice(0, 10);
  })();
  for (const t of single.filter((x) => x.date > recentFrom)) {
    const earlier = single
      .filter(
        (x) =>
          x.categoryId === t.categoryId && x.date.slice(0, 7) >= full[0]! && x.date <= recentFrom,
      )
      .map((x) => x.amount);
    if (earlier.length < T.largeMinRows || t.amount < T.largeMin) continue;
    const usual = median(earlier);
    if (usual <= 0 || t.amount < usual * T.largeTimes) continue;
    out.push({
      id: `large:${t.id}`,
      kind: 'large',
      tone: 'info',
      data: {
        merchant: t.merchant?.trim() || null,
        amount: t.amount,
        date: t.date,
        category: name.get(t.categoryId!),
        times: Math.round(t.amount / usual),
      },
      link: `/transactions?month=${t.date.slice(0, 7)}${
        t.merchant?.trim() ? `&q=${encodeURIComponent(t.merchant.trim())}` : ''
      }`,
      size: t.amount,
    });
  }

  return out.sort(
    (a, b) =>
      TONE_ORDER[a.tone] - TONE_ORDER[b.tone] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.size - a.size,
  );
}

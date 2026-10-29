/** The ECB's reference rates for a day: dollars and rupees per euro. */
export type FxPoint = { date: string; usdPerEur: number; inrPerEur: number };
export type FxCurrency = 'EUR' | 'USD' | 'INR';
export type FxTransfer = {
  id: string;
  date: string;
  from: FxCurrency;
  to: FxCurrency;
  fromAccount: string;
  toAccount: string;
  /** minor units, on each side */
  sent: number;
  received: number;
  /** the ECB rate used (the day's, or the last before) */
  marketDate: string;
  /** both quoted the usual way: ₹ per €, ₹ per $, $ per € */
  yourRate: number;
  marketRate: number;
  atMarket: number;
  /** received − at the market rate, in the received currency */
  diff: number;
  diffPct: number;
};
export type CurrencyAnalytics = {
  asOf: string | null;
  series: FxPoint[];
  transfers: FxTransfer[];
  /** transfers from before the first rate kept (2020): not compared */
  uncompared: number;
  refreshError: string | null;
};

export type Pair = {
  key: 'EURINR' | 'USDINR' | 'EURUSD';
  from: FxCurrency;
  to: FxCurrency;
  label: string;
  name: string;
  color: string;
};
/** In a fixed order, each with its own colour (the categorical palette's first three). */
export const PAIRS: Pair[] = [
  {
    key: 'EURINR',
    from: 'EUR',
    to: 'INR',
    label: '€ → ₹',
    name: 'Euro in rupees',
    color: 'var(--c-cat-1)',
  },
  {
    key: 'USDINR',
    from: 'USD',
    to: 'INR',
    label: '$ → ₹',
    name: 'Dollar in rupees',
    color: 'var(--c-cat-2)',
  },
  {
    key: 'EURUSD',
    from: 'EUR',
    to: 'USD',
    label: '€ → $',
    name: 'Euro in dollars',
    color: 'var(--c-cat-3)',
  },
];

const perEuro = (p: FxPoint, c: FxCurrency) =>
  c === 'EUR' ? 1 : c === 'USD' ? p.usdPerEur : p.inrPerEur;
/** How many of the pair's `to` one `from` buys that day. */
export const pairRate = (p: FxPoint, pair: Pair) => perEuro(p, pair.to) / perEuro(p, pair.from);

/** A rate as it is quoted: rupees to the paisa, dollars per euro to four places. */
export const formatRate = (v: number, to: FxCurrency) =>
  to === 'INR'
    ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${v.toFixed(4)}`;

export const RANGES = [
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 91 },
  { key: '6M', label: '6M', days: 182 },
  { key: '1Y', label: '1Y', days: 365 },
  { key: '3Y', label: '3Y', days: 1096 },
  { key: 'all', label: 'All', days: null },
] as const;
export type RangeKey = (typeof RANGES)[number]['key'];

const minusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Index of the last point on or before `date` (−1: none). */
function lastOnOrBefore(series: FxPoint[], date: string) {
  let found = -1;
  for (let i = 0; i < series.length && series[i]!.date <= date; i++) found = i;
  return found;
}

/** The points of a range up to the latest rate, from the last one on or before its start. */
export function inRange(series: FxPoint[], range: RangeKey): FxPoint[] {
  const days = RANGES.find((r) => r.key === range)!.days;
  const last = series.at(-1);
  if (!last || days === null) return series;
  const start = minusDays(last.date, days);
  const first = lastOnOrBefore(series, start);
  return series.slice(Math.max(0, first));
}

/** A pair's change since the rate before the latest, a month or a year before it. */
export function since(series: FxPoint[], pair: Pair, span: 'day' | 'month' | 'year') {
  const last = series.at(-1);
  if (!last) return null;
  const before =
    span === 'day'
      ? series.at(-2)
      : series[lastOnOrBefore(series, minusDays(last.date, span === 'month' ? 30 : 365))];
  if (!before) return null;
  const a = pairRate(before, pair);
  const b = pairRate(last, pair);
  return { from: a, to: b, pct: (b / a - 1) * 100, date: before.date };
}

/**
 * Ticks for a rate's axis: round steps (1, 2 or 5 × a power of ten) covering just its band, so a
 * move of a few percent is visible (an axis from zero would flatten it).
 */
export function bandTicks(lo: number, hi: number): number[] {
  if (hi - lo < 1e-9)
    return bandTicks(
      lo - Math.max(Math.abs(lo) * 0.01, 1e-6),
      hi + Math.max(Math.abs(hi) * 0.01, 1e-6),
    );
  const raw = (hi - lo) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const first = Math.floor(lo / step + 1e-9) * step;
  const ticks: number[] = [];
  for (let t = first; t < hi + step - 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Each pair's change in % since the first point, for one chart with one scale. */
export function indexed(points: FxPoint[]) {
  const first = points[0];
  return points.map((p) => ({
    date: p.date,
    ...(Object.fromEntries(
      PAIRS.map((pair) => [
        pair.key,
        first ? (pairRate(p, pair) / pairRate(first, pair) - 1) * 100 : 0,
      ]),
    ) as Record<Pair['key'], number>),
  }));
}

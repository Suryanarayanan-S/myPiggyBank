/**
 * IBJA's 22K and 24K rates for the days before the first one stored (IBJA has no free history),
 * estimated from GOLDBEES, whose price follows the Indian gold price: GOLDBEES × the ratio IBJA ÷
 * GOLDBEES. The ratio drifts a little each year (the fund's costs), so it is fitted as a straight
 * line through the stored days and through RBI's gold bond issue prices (each the average IBJA
 * 999 rate of the week before its subscription, about 12 days before the issue). Pure.
 */
type Point = { date: string; value: number };

const DAY = 86_400_000;
/** RBI fixes an issue's price from the week before subscription: about this long before issue. */
const PRICED_BEFORE_ISSUE = 12;
/** A fitted drift needs this long a span; shorter, the ratio is taken as constant. */
const MIN_SPAN_DAYS = 180;

const t = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

/** GOLDBEES on a day, between its two nearest points (at most 10 days apart either side). */
function valueOn(series: Point[], date: string): number | null {
  const x = t(date);
  const after = series.findIndex((p) => t(p.date) >= x);
  if (after < 0) return null;
  const b = series[after]!;
  if (t(b.date) === x) return b.value;
  const a = series[after - 1];
  if (!a || x - t(a.date) > 10 || t(b.date) - x > 10) return null;
  return a.value + ((b.value - a.value) * (x - t(a.date))) / (t(b.date) - t(a.date));
}

export function estimateIndianGold(input: {
  /** GOLDBEES closes, oldest first */
  goldbees: Point[];
  /** stored IBJA rates per gram, oldest first */
  k24: Point[];
  k22: Point[];
  /** gold bond issue prices per gram, dated by their issue */
  anchors: Point[];
}): { k24: Point[]; k22: Point[]; until: string | null } {
  const { goldbees, k24, k22, anchors } = input;
  const until = k24[0]?.date ?? null;
  if (!until) return { k24: [], k22: [], until: null };
  // (day, ratio) pairs: each stored IBJA day with GOLDBEES that day, and each gold bond priced
  // after the fund's history starts
  const pairs: { x: number; r: number }[] = [];
  for (const p of k24) {
    const g = valueOn(goldbees, p.date);
    if (g) pairs.push({ x: t(p.date), r: p.value / g });
  }
  for (const a of anchors) {
    const priced = new Date((t(a.date) - PRICED_BEFORE_ISSUE) * DAY).toISOString().slice(0, 10);
    if (priced >= until) continue;
    const g = valueOn(goldbees, priced);
    if (g) pairs.push({ x: t(priced), r: a.value / g });
  }
  if (pairs.length === 0) return { k24: [], k22: [], until };
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const mr = pairs.reduce((s, p) => s + p.r, 0) / n;
  const span = Math.max(...pairs.map((p) => p.x)) - Math.min(...pairs.map((p) => p.x));
  const sxx = pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope =
    span >= MIN_SPAN_DAYS && sxx > 0
      ? pairs.reduce((s, p) => s + (p.x - mx) * (p.r - mr), 0) / sxx
      : 0;
  const ratio = (date: string) => mr + slope * (t(date) - mx);
  // 22K as a share of 24K on the stored days (916 ÷ 999 when none)
  const shares = k22
    .map((p) => {
      const full = k24.find((q) => q.date === p.date);
      return full ? p.value / full.value : null;
    })
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b);
  const share = shares.length ? shares[Math.floor(shares.length / 2)]! : 916 / 999;
  const est = goldbees
    .filter((g) => g.date < until)
    .map((g) => ({ date: g.date, value: g.value * ratio(g.date) }));
  return {
    k24: est,
    k22: est.map((p) => ({ date: p.date, value: p.value * share })),
    until,
  };
}

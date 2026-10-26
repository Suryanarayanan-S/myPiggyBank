/**
 * Your money against the same money elsewhere: every buy and sale of the holdings repeated, on
 * its day and for its amount, in a market line (Nifty 50, GOLDBEES, gold per gram), so the gains
 * can be set side by side. Dividends are left out on both sides (the market lines are prices).
 */
import type { Holding } from './investments';
import { valueHistory, xirr } from './portfolio';

type Point = { date: string; value: number };
/** paise: + money put in (a buy, with its fees), − money taken out (a sale, after fees) */
export type Flow = { date: string; amount: number };

/**
 * The holdings' buys and sales as the value history counts them: archived ones left out, and a
 * sale of more units than held (buys missing) only for the units held.
 */
export function cashFlows(holdings: Holding[]): Flow[] {
  return holdings
    .filter((h) => !h.archived)
    .flatMap((h) => {
      let units = 0;
      // oldest first (the API sends newest first; a day's order is kept)
      return [...h.trades]
        .reverse()
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((t) => (t.type === 'buy' || t.type === 'sell') && t.units)
        .map((t) => {
          const u = Number(t.units);
          if (t.type === 'buy') {
            units += u;
            return { date: t.date, amount: t.amount + t.fees };
          }
          const sold = Math.min(u, units);
          units -= sold;
          return { date: t.date, amount: -Math.round(((t.amount - t.fees) * sold) / u) };
        });
    })
    .filter((f) => f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The line's price on a day: the last on or before it, else the first after (null: none). */
function priceOn(series: Point[], day: string): number | null {
  if (series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  if (series[0]!.date > day) return series[0]!.value;
  // the last point on or before the day
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid]!.date <= day) lo = mid;
    else hi = mid - 1;
  }
  return series[lo]!.value;
}

/**
 * What the same money would be worth in a market line on each of `days` (paise). Money taken out
 * sells the line, but never more than it holds: what it lacks (yours did better) is owed as a
 * fixed sum, not bet against the market.
 */
export function sameMoney(flows: Flow[], series: Point[], days: string[]): Point[] {
  if (series.length === 0) return [];
  let units = 0;
  let cash = 0;
  let next = 0;
  return days.map((day) => {
    for (; next < flows.length && flows[next]!.date <= day; next++) {
      const f = flows[next]!;
      const price = priceOn(series, f.date)!;
      if (f.amount >= 0) {
        units += f.amount / price;
      } else {
        const sold = Math.min(units, -f.amount / price);
        units -= sold;
        cash -= -f.amount - sold * price;
      }
    }
    return { date: day, value: Math.round(units * priceOn(series, day)! + cash) };
  });
}

export type LineSummary = { value: number; gain: number; xirr: number | null };

/**
 * Yours and each market line, day by day: the gain over the money put in so far; and today's
 * value, gain and yearly rate (XIRR) of each.
 */
export function sameMoneyComparison(holdings: Holding[], markets: Record<string, Point[]>) {
  const flows = cashFlows(holdings);
  const yours = valueHistory(holdings);
  const days = yours.map((p) => p.date);
  const lines: Record<string, Point[]> = { portfolio: yours };
  for (const [key, series] of Object.entries(markets)) {
    if (series.length > 0) lines[key] = sameMoney(flows, series, days);
  }
  let put = 0;
  let f = 0;
  const rows = days.map((day, i) => {
    for (; f < flows.length && flows[f]!.date <= day; f++) put += flows[f]!.amount;
    return {
      date: day,
      invested: put,
      gain: Object.fromEntries(Object.entries(lines).map(([k, l]) => [k, l[i]!.value - put])),
    };
  });
  const last = days.at(-1);
  // over a few weeks a yearly rate says little (and wildly): three months at least
  const long =
    !!last && !!flows[0] && Date.parse(last) - Date.parse(flows[0].date) >= 90 * 86_400_000;
  const summary: Record<string, LineSummary> = {};
  for (const [k, l] of Object.entries(lines)) {
    const value = l.at(-1)?.value ?? 0;
    summary[k] = {
      value,
      gain: value - put,
      // money in is paid (−), money out and what it is worth today received (+)
      xirr: long
        ? xirr([
            ...flows.map((x) => ({ date: x.date, amount: -x.amount })),
            { date: last!, amount: value },
          ])
        : null,
    };
  }
  return { invested: put, rows, summary };
}

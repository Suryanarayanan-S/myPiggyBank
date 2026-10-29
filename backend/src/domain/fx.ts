/** The ECB's reference rates for a day: dollars and rupees per euro. */
export type FxPoint = { date: string; usdPerEur: number; inrPerEur: number };
export type FxCurrency = 'EUR' | 'USD' | 'INR';
export const FX_CURRENCIES: FxCurrency[] = ['EUR', 'USD', 'INR'];

/** The days both series have (the ECB publishes both together; a gap is a day not yet in). */
export function fxSeries(
  usd: { date: string; value: number }[],
  inr: { date: string; value: number }[],
): FxPoint[] {
  const dollars = new Map(usd.map((p) => [p.date, p.value]));
  return inr
    .filter((p) => dollars.has(p.date))
    .map((p) => ({ date: p.date, usdPerEur: dollars.get(p.date)!, inrPerEur: p.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const perEuro = (p: FxPoint, c: FxCurrency) =>
  c === 'EUR' ? 1 : c === 'USD' ? p.usdPerEur : p.inrPerEur;

/** How many `to` one `from` buys that day (USD→INR = rupees per euro ÷ dollars per euro). */
export function rate(p: FxPoint, from: FxCurrency, to: FxCurrency): number {
  return from === to ? 1 : perEuro(p, to) / perEuro(p, from);
}

/** The last rates published on or before `date` (weekends and holidays have none). */
export function rateOn(series: FxPoint[], date: string): FxPoint | null {
  let found: FxPoint | null = null;
  for (const p of series) {
    if (p.date > date) break;
    found = p;
  }
  return found;
}

const minusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The pair's move over `days` up to `asOf`: from the rate on or before the start. */
export function changeOver(
  series: FxPoint[],
  from: FxCurrency,
  to: FxCurrency,
  days: number,
  asOf: string,
) {
  const start = rateOn(series, minusDays(asOf, days));
  const end = rateOn(series, asOf);
  if (!start || !end) return null;
  const a = rate(start, from, to);
  const b = rate(end, from, to);
  return { from: a, to: b, pct: (b / a - 1) * 100, since: start.date };
}

/** Money moved between two currencies, minor units on each side. */
export type FxTransfer = {
  date: string;
  from: FxCurrency;
  to: FxCurrency;
  sent: number;
  received: number;
};

/**
 * A transfer against the ECB rate of its day (or the last before): the rate got and the market's,
 * both quoted the usual way (the stronger currency first: ₹ per €, ₹ per $, $ per €), and how much
 * more (+) or less (−) arrived than at the market rate, in the received currency.
 */
export function compareTransfer(t: FxTransfer, series: FxPoint[]) {
  const p = rateOn(series, t.date);
  if (!p || t.sent <= 0 || t.received <= 0) return null;
  const atMarket = Math.round(t.sent * rate(p, t.from, t.to));
  // quoted as units of the weaker currency per unit of the stronger one
  const strong = rate(p, t.from, t.to) >= 1 ? t.from : t.to;
  const yourRate = strong === t.from ? t.received / t.sent : t.sent / t.received;
  const marketRate = strong === t.from ? rate(p, t.from, t.to) : rate(p, t.to, t.from);
  return {
    marketDate: p.date,
    yourRate,
    marketRate,
    atMarket,
    diff: t.received - atMarket,
    diffPct: (t.received / atMarket - 1) * 100,
  };
}

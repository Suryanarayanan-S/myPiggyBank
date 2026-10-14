import type { Holding } from './investments';

/**
 * A holding in the list with its value, cost and share of the portfolio in `currency` — the
 * summary currency, or its own when there is no exchange rate (then it has no weight and is
 * left out of totals). `empty`: nothing bought yet, so no value to show.
 */
export type RankedHolding = {
  holding: Holding;
  currency: string;
  value: number;
  cost: number;
  weightBp: number | null;
  empty: boolean;
};

/** Units are held. */
const isHeld = (h: Holding) => !h.archived && Number(h.units) > 0;
/** Everything was sold: kept for its history, out of the list. */
export const isSoldOut = (h: Holding) =>
  !h.archived && Number(h.units) === 0 && h.trades.some((t) => t.type === 'sell');
/** Added but nothing bought yet. */
const isNew = (h: Holding) => !h.archived && Number(h.units) === 0 && !isSoldOut(h);

/** Held holdings that can be compared (they have a value in the summary currency), largest first. */
export function ranked(holdings: Holding[], currency = ''): RankedHolding[] {
  const rows = holdings
    .filter((h) => isHeld(h) && h.inView !== null)
    .map((h) => ({ holding: h, currency, value: h.inView!.value, cost: h.inView!.cost }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows
    .map((r) => ({
      ...r,
      weightBp: total > 0 ? Math.round((r.value * 10_000) / total) : 0,
      empty: false,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Every holding for the list: comparable ones, then those without a rate, then new ones. */
export function listed(holdings: Holding[], currency: string): RankedHolding[] {
  const apart = (h: Holding, empty: boolean): RankedHolding => ({
    holding: h,
    currency: h.currency,
    value: h.value ?? 0,
    cost: h.cost,
    weightBp: null,
    empty,
  });
  return [
    ...ranked(holdings, currency),
    ...holdings.filter((h) => isHeld(h) && h.inView === null).map((h) => apart(h, false)),
    ...holdings.filter(isNew).map((h) => apart(h, true)),
  ];
}

/** The biggest gainers and losers by return (a return needs no exchange rate). */
export function movers(holdings: Holding[], n: number) {
  const withReturn = holdings.filter((h) => isHeld(h) && h.returnBp !== null);
  return {
    gainers: withReturn
      .filter((h) => h.returnBp! > 0)
      .sort((a, b) => b.returnBp! - a.returnBp!)
      .slice(0, n),
    losers: withReturn
      .filter((h) => h.returnBp! < 0)
      .sort((a, b) => a.returnBp! - b.returnBp!)
      .slice(0, n),
  };
}

/** How many held holdings are up, down or even (in their own currency, so no rate is needed). */
export function profitSplit(holdings: Holding[]) {
  const held = holdings.filter((h) => isHeld(h) && h.unrealised !== null);
  return {
    profit: held.filter((h) => h.unrealised! > 0).length,
    loss: held.filter((h) => h.unrealised! < 0).length,
    flat: held.filter((h) => h.unrealised === 0).length,
  };
}

export type SortKey = 'name' | 'units' | 'invested' | 'value' | 'pnl' | 'pnlPct' | 'weight';
// Money columns only compare amounts in the summary currency; other rows sort last.
const inSummary = (r: RankedHolding, n: number) => (r.weightBp === null ? null : n);
const sortValue: Record<SortKey, (r: RankedHolding) => number | string | null> = {
  name: (r) => r.holding.name,
  units: (r) => Number(r.holding.units),
  invested: (r) => inSummary(r, r.cost),
  value: (r) => inSummary(r, r.value),
  pnl: (r) => inSummary(r, r.value - r.cost),
  pnlPct: (r) => r.holding.returnBp,
  weight: (r) => r.weightBp,
};

/** Sorted by a column; rows without a value for it (e.g. no return) always come last. */
export function sortHoldings(rows: RankedHolding[], key: SortKey, dir: 'asc' | 'desc') {
  const get = sortValue[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order =
      typeof x === 'string'
        ? x.localeCompare(String(y))
        : x < (y as number)
          ? -1
          : x > (y as number)
            ? 1
            : 0;
    return order * sign;
  });
}

/**
 * The portfolio's value on each day a price or trade was recorded (each import adds a day).
 * Only when every holding is in one currency, so the days add up without exchange rates.
 * Each holding is valued like on the server: the newer of the last price and the last trade
 * price (the day's latest trade), a price winning on the same day.
 */
export function valueHistory(holdings: Holding[]): { date: string; value: number }[] {
  const list = holdings.filter((h) => !h.archived);
  if (list.length === 0 || new Set(list.map((h) => h.currency)).size !== 1) return [];
  // Trades arrive newest first: reversed, then sorted by day (stable), the day's order is kept.
  const prepared = list.map((h) => ({
    trades: [...h.trades].reverse().sort((a, b) => a.date.localeCompare(b.date)),
    prices: [...h.prices].sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const days = [
    ...new Set(
      prepared.flatMap((p) => [...p.trades.map((t) => t.date), ...p.prices.map((x) => x.date)]),
    ),
  ].sort();
  return days.map((day) => {
    let value = 0;
    for (const p of prepared) {
      let units = 0;
      let tradePrice: { date: string; price: number } | null = null;
      for (const t of p.trades) {
        if (t.date > day) break;
        if (t.type === 'dividend' || !t.units) continue;
        const u = Number(t.units);
        units += t.type === 'buy' ? u : -Math.min(u, units);
        if (u > 0) tradePrice = { date: t.date, price: t.amount / u };
      }
      const last = p.prices.filter((x) => x.date <= day).at(-1);
      const price =
        last && (!tradePrice || last.date >= tradePrice.date)
          ? Number(last.price) * 100
          : (tradePrice?.price ?? 0);
      value += Math.round(units * price);
    }
    return { date: day, value };
  });
}

/** Whether `valueHistory` can chart these holdings at all (one currency only). */
export const oneCurrency = (holdings: Holding[]) =>
  new Set(holdings.filter((h) => !h.archived).map((h) => h.currency)).size <= 1;

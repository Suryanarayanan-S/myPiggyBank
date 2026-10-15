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

/** How holdings are grouped for a share-of-portfolio chart; null leaves a holding out. */
export type Grouping = {
  title: string;
  groupOf: (h: Holding) => string | null;
  /** Groups with a colour of their own (slot 1–4), the same in every chart. */
  pinned?: Record<string, number>;
};
const UNKNOWN = 'Not classified';

/** Equity (shares and funds) against gold, like a broker's account split. */
export const ACCOUNT: Grouping = {
  title: 'Account',
  groupOf: (h) => (h.kind === 'gold' ? 'Gold' : h.kind === 'other' ? 'InvIT & other' : 'Equity'),
  pinned: { Equity: 1, 'InvIT & other': 3, Gold: 4 },
};
/** Industries of shares; funds and gold as their own groups. */
export const SECTOR: Grouping = {
  title: 'Sectors',
  groupOf: (h) =>
    h.kind === 'gold'
      ? 'Gold'
      : h.kind === 'etf'
        ? 'ETF'
        : h.kind === 'fund'
          ? 'Mutual funds'
          : h.kind === 'other'
            ? 'InvIT & other'
            : (h.industry ?? UNKNOWN),
  pinned: { Gold: 4 },
};
const CAP_LABEL = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' } as const;
/** SEBI size groups — shares only. */
export const CAP: Grouping = {
  title: 'Market cap',
  groupOf: (h) => (h.kind !== 'stock' ? null : h.cap ? CAP_LABEL[h.cap] : UNKNOWN),
  pinned: { 'Large cap': 1, 'Mid cap': 2, 'Small cap': 3 },
};

export type Slice = { label: string; value: number; shareBp: number };

/**
 * Shares of the portfolio by group (summary currency), largest first and at most `top` groups
 * plus "Other" — a donut stays readable at five slices. "Not classified" never leads.
 */
export function allocation(holdings: Holding[], grouping: Grouping, top = 4): Slice[] {
  const sums = new Map<string, number>();
  for (const r of ranked(holdings)) {
    const g = grouping.groupOf(r.holding);
    if (g !== null && r.value > 0) sums.set(g, (sums.get(g) ?? 0) + r.value);
  }
  const groups = [...sums]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => Number(a.label === UNKNOWN) - Number(b.label === UNKNOWN) || b.value - a.value);
  const shown =
    groups.length <= top + 1
      ? groups
      : [
          ...groups.slice(0, top),
          { label: 'Other', value: groups.slice(top).reduce((s, g) => s + g.value, 0) },
        ];
  const total = shown.reduce((s, g) => s + g.value, 0);
  return shown.map((g) => ({
    ...g,
    shareBp: total > 0 ? Math.round((g.value * 10_000) / total) : 0,
  }));
}

/** Every group with its share (for the legend list and table: nothing folded away). */
export function allGroups(holdings: Holding[], grouping: Grouping): Slice[] {
  return allocation(holdings, grouping, Number.MAX_SAFE_INTEGER);
}

/** What added and what took away the most money (summary currency), like a broker's report. */
export function contributors(holdings: Holding[], n: number) {
  const rows = ranked(holdings).map((r) => ({ ...r, pnl: r.value - r.cost }));
  return {
    performers: rows
      .filter((r) => r.pnl > 0)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, n),
    decliners: rows
      .filter((r) => r.pnl < 0)
      .sort((a, b) => a.pnl - b.pnl)
      .slice(0, n),
  };
}

/**
 * Colours of a donut's slices: a group with a colour of its own keeps it everywhere (Gold is
 * always the same yellow); other groups take the free slots by size; the rest is neutral.
 */
export function sliceColors(grouping: Grouping, slices: { label: string }[]): string[] {
  const pinned = grouping.pinned ?? {};
  const taken = new Set(slices.map((s) => pinned[s.label]).filter((n): n is number => !!n));
  const free = [1, 2, 3, 4].filter((n) => !taken.has(n));
  return slices.map((s) => {
    if (s.label === 'Other' || s.label === UNKNOWN) return 'var(--c-rest)';
    const slot = pinned[s.label] ?? free.shift();
    return slot ? `var(--c-cat-${slot})` : 'var(--c-rest)';
  });
}

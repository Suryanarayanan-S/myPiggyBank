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

export type SortKey =
  'name' | 'units' | 'invested' | 'value' | 'pnl' | 'pnlPct' | 'dayPct' | 'weight';
/** A holding's move on the latest market day (see `dayChanges`). */
export type DayChange = {
  /** in the summary currency, or the holding's own without an exchange rate */
  pnl: number;
  changeBp: number;
  /** pnl is in the summary currency (comparable, counted in totals) */
  inSummary: boolean;
};
// Money columns only compare amounts in the summary currency; other rows sort last.
const inSummary = (r: RankedHolding, n: number) => (r.weightBp === null ? null : n);
const sortValue: Record<
  SortKey,
  (r: RankedHolding, day: Map<string, DayChange>) => number | string | null
> = {
  name: (r) => r.holding.name,
  units: (r) => Number(r.holding.units),
  invested: (r) => inSummary(r, r.cost),
  value: (r) => inSummary(r, r.value),
  pnl: (r) => inSummary(r, r.value - r.cost),
  pnlPct: (r) => r.holding.returnBp,
  dayPct: (r, day) => day.get(r.holding.id)?.changeBp ?? null,
  weight: (r) => r.weightBp,
};

/** Sorted by a column; rows without a value for it (e.g. no return) always come last. */
export function sortHoldings(
  rows: RankedHolding[],
  key: SortKey,
  dir: 'asc' | 'desc',
  day = new Map<string, DayChange>(),
) {
  const get = (r: RankedHolding) => sortValue[key](r, day);
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

/** Equity (shares, funds, listed trusts) against gold, like a broker's account split. */
export const ACCOUNT: Grouping = {
  title: 'Account',
  // Like a broker's account view: whatever trades on an exchange (InvITs and REITs included)
  // is equity; only something unlisted, without a symbol, stays apart.
  groupOf: (h) =>
    h.kind === 'gold' ? 'Gold' : h.kind === 'other' && !h.symbol ? 'Other' : 'Equity',
  pinned: { Equity: 1, Gold: 4 },
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

/** What a share-of-portfolio chart measures: worth now, or the money put in. */
export type Measure = 'value' | 'cost';

/**
 * Shares of the portfolio by group (summary currency), largest first and at most `top` groups
 * plus "Other" — a donut stays readable at five slices. "Not classified" never leads.
 * The groups and their order always follow worth now, so switching to money put in only
 * resizes the slices (each group keeps its place and colour).
 */
export function allocation(
  holdings: Holding[],
  grouping: Grouping,
  top = 4,
  measure: Measure = 'value',
): Slice[] {
  const sums = new Map<string, { value: number; cost: number }>();
  for (const r of ranked(holdings)) {
    const g = grouping.groupOf(r.holding);
    if (g === null || r.value <= 0) continue;
    const s = sums.get(g) ?? { value: 0, cost: 0 };
    sums.set(g, { value: s.value + r.value, cost: s.cost + Math.max(0, r.cost) });
  }
  const groups = [...sums]
    .map(([label, s]) => ({ label, ...s }))
    .sort((a, b) => Number(a.label === UNKNOWN) - Number(b.label === UNKNOWN) || b.value - a.value);
  const shown =
    groups.length <= top + 1
      ? groups
      : [
          ...groups.slice(0, top),
          groups
            .slice(top)
            .reduce(
              (o, g) => ({ label: 'Other', value: o.value + g.value, cost: o.cost + g.cost }),
              {
                label: 'Other',
                value: 0,
                cost: 0,
              },
            ),
        ];
  const total = shown.reduce((s, g) => s + g[measure], 0);
  return shown.map((g) => ({
    label: g.label,
    value: g[measure],
    shareBp: total > 0 ? Math.round((g[measure] * 10_000) / total) : 0,
  }));
}

/** Every group with its share (for the legend list and table: nothing folded away). */
export function allGroups(
  holdings: Holding[],
  grouping: Grouping,
  measure: Measure = 'value',
): Slice[] {
  return allocation(holdings, grouping, Number.MAX_SAFE_INTEGER, measure);
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

/** A weekend date (Zerodha imports on a Saturday repeat Friday's close). */
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const DAY_MS = 86_400_000;

/**
 * Each held holding's move on the latest market day: its last price against its price
 * before, times the units held, in the summary currency. The day is the one most holdings have
 * their last price on (one hand-entered price never decides it); weekend prices are skipped.
 * Left out: holdings whose last price is on another day, whose price before is more than five
 * days older (a month's change is not a day's move), and those bought or sold since the price
 * before (the move would mix in the trade).
 */
export function dayChanges(holdings: Holding[]) {
  // Holdings without an exchange rate are included too: their % needs no rate.
  const rows = listed(holdings, '').flatMap((r) => {
    if (r.empty || !isHeld(r.holding)) return [];
    const prices = r.holding.prices
      .filter((p) => !weekend(p.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const last = prices.at(-1);
    const before = prices.at(-2);
    if (!last || !before || !r.holding.value) return [];
    const gap = Date.parse(last.date) - Date.parse(before.date);
    const traded = r.holding.trades.some(
      (t) => t.type !== 'dividend' && !!t.units && t.date > before.date,
    );
    const from = Number(before.price);
    if (gap > 5 * DAY_MS || traded || from <= 0) return [];
    const step = Number(last.price) - from;
    // in the summary currency, like the rest of the overview (or its own: then r.value is too)
    const pnl = Math.round(Number(r.holding.units) * step * 100 * (r.value / r.holding.value));
    const changeBp = Math.round((step / from) * 10_000);
    return [{ ...r, date: last.date, pnl, changeBp, inSummary: r.weightBp !== null }];
  });
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.date, (count.get(r.date) ?? 0) + 1);
  // the most shared day; on a tie the later one
  const date = [...count].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  const today = rows.filter((r) => r.date === date);
  return {
    date,
    rows: today,
    byId: new Map<string, DayChange>(
      today.map((r) => [
        r.holding.id,
        { pnl: r.pnl, changeBp: r.changeBp, inSummary: r.inSummary },
      ]),
    ),
  };
}

/**
 * The whole portfolio's move on the latest market day (summary currency): against the value
 * the day before of the holdings that moved. Null without a day.
 */
export function dayTotal(holdings: Holding[]) {
  const { date, rows } = dayChanges(holdings);
  const counted = rows.filter((r) => r.inSummary);
  if (!date || counted.length === 0) return null;
  const pnl = counted.reduce((s, r) => s + r.pnl, 0);
  const before = counted.reduce((s, r) => s + r.value, 0) - pnl;
  return { date, pnl, changeBp: before > 0 ? Math.round((pnl * 10_000) / before) : 0 };
}

/** The day's biggest movers each way (see `dayChanges`). */
export function dayMovers(holdings: Holding[], n: number) {
  const { date, rows } = dayChanges(holdings);
  // money is only compared in the summary currency
  const today = rows.filter((r) => r.inSummary);
  return {
    date,
    performers: today
      .filter((r) => r.pnl > 0)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, n),
    decliners: today
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

/**
 * The portfolio's performance as an index (1 = the first day), time-weighted: money bought or
 * sold on a day is taken out of that day's change, so adding money never looks like a gain.
 * One currency only (like `valueHistory`).
 */
export function returnIndex(holdings: Holding[]): { date: string; index: number }[] {
  const flows = new Map<string, number>();
  for (const h of holdings.filter((x) => !x.archived)) {
    for (const t of h.trades) {
      // Like valueHistory: only trades that move units move money in or out.
      if (t.type === 'dividend' || !t.units) continue;
      const money = t.type === 'buy' ? t.amount + t.fees : -(t.amount - t.fees);
      flows.set(t.date, (flows.get(t.date) ?? 0) + money);
    }
  }
  const out: { date: string; index: number }[] = [];
  let index = 0;
  let before = 0;
  for (const p of valueHistory(holdings)) {
    if (before > 0) {
      index *= (p.value - (flows.get(p.date) ?? 0)) / before;
      out.push({ date: p.date, index: Math.round(index * 1e10) / 1e10 });
    } else if (p.value > 0 && out.length === 0) {
      index = 1;
      out.push({ date: p.date, index });
    }
    before = p.value;
  }
  return out;
}

export type ComparisonRow = {
  date: string;
  /** change since the start in basis points, by series ("portfolio" and each compared one);
   *  null: no point that day */
  change: Record<string, number | null>;
  /** each series' own value that day, as passed in (index points, ₹ per gram, $ per ounce;
   *  for yours the return index, not money) */
  price: Record<string, number | null>;
};

/**
 * The ticked series as % change since the first day all of them are known
 * (each measured from its last value on or before that day). For yours, pass `returnIndex`.
 */
export function compareSince(
  series: Record<string, { date: string; value: number }[]>,
): ComparisonRow[] {
  const all = Object.values(series);
  if (all.length === 0 || all.some((s) => s.length === 0)) return [];
  const start = all
    .map((s) => s[0]!.date)
    .sort()
    .at(-1)!;
  const keys = Object.keys(series);
  const bases = Object.fromEntries(
    keys.map((k) => [k, series[k]!.filter((p) => p.date <= start).at(-1)!.value]),
  );
  const valueOn = (k: string, day: string) => series[k]!.find((x) => x.date === day)?.value ?? null;
  const days = [...new Set(all.flatMap((s) => s.map((p) => p.date)))]
    .filter((d) => d >= start)
    .sort();
  return days.map((d) => ({
    date: d,
    change: Object.fromEntries(
      keys.map((k) => {
        if (d === start) return [k, 0];
        const v = valueOn(k, d);
        return [k, v !== null && bases[k]! > 0 ? Math.round((v / bases[k]! - 1) * 10_000) : null];
      }),
    ),
    price: Object.fromEntries(keys.map((k) => [k, d === start ? bases[k]! : valueOn(k, d)])),
  }));
}

const QUARTER_MONTHS = ['Jan – Mar', 'Apr – Jun', 'Jul – Sep', 'Oct – Dec'];
/** At most this many quarters are drawn (the latest ones). */
const MAX_QUARTERS = 8;

/**
 * Dividends and interest received per calendar quarter (like Console's report), from the first
 * payout up to the quarter of `today`, the last eight at most. Only holdings in `currency` (the
 * summary currency) are added up; archived ones too — the money came in all the same.
 */
export function incomeByQuarter(holdings: Holding[], currency: string, today: string) {
  const quarterOf = (d: string) =>
    Number(d.slice(0, 4)) * 4 + Math.floor((Number(d.slice(5, 7)) - 1) / 3);
  const payouts = holdings
    .filter((h) => h.currency === currency)
    .flatMap((h) => h.trades)
    .filter((t) => (t.type === 'dividend' || t.type === 'interest') && t.date <= today);
  if (payouts.length === 0) return null;
  const last = quarterOf(today);
  const first = Math.max(
    Math.min(...payouts.map((t) => quarterOf(t.date))),
    last - MAX_QUARTERS + 1,
  );
  const quarters = Array.from({ length: last - first + 1 }, (_, i) => {
    const q = first + i;
    return {
      key: `${Math.floor(q / 4)}-Q${(q % 4) + 1}`,
      label: `${QUARTER_MONTHS[q % 4]} ’${String(Math.floor(q / 4)).slice(2)}`,
      dividend: 0,
      interest: 0,
    };
  });
  let count = 0;
  for (const t of payouts) {
    const q = quarterOf(t.date) - first;
    if (q < 0) continue;
    quarters[q]![t.type as 'dividend' | 'interest'] += t.amount;
    count++;
  }
  const total = quarters.reduce((s, q) => s + q.dividend + q.interest, 0);
  /** older payouts were left out (only the last eight quarters are drawn) */
  const trimmed = count < payouts.length;
  return { quarters, total, count, trimmed };
}

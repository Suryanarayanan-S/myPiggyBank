/**
 * Returns compared across kinds of investment: each one as cash flows (money put in negative,
 * money back positive, each on its day) plus what it is worth today, so a share, a fixed deposit
 * and a gold coin get the same yardstick — the gain and the yearly rate (XIRR). Pure.
 */
import {
  addMonths,
  depositValue,
  instalmentsDue,
  payoutPerPeriod,
  recurringValue,
  savingsValue,
  type DepositTerms,
  type RecurringTerms,
  type SavingsTerms,
} from './deposits.js';

/** minor units: − put in, + back out */
export type Flow = { date: string; amount: number };
/** The flows so far, and what is still held is worth today (0 once paid out or sold). */
export type Flows = { flows: Flow[]; worth: number };

const YEAR_MS = 365 * 86_400_000;
/** Over a few weeks a yearly rate says little (and wildly): three months at least. */
export const MIN_XIRR_DAYS = 90;

/**
 * The yearly rate that makes the flows worth nothing together, like a spreadsheet's XIRR.
 * Null without an answer (every flow one way, or a rate beyond −99.99 % … +1000 %).
 */
export function xirr(flows: Flow[]): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...flows.map((f) => Date.parse(f.date)));
  const years = flows.map((f) => (Date.parse(f.date) - t0) / YEAR_MS);
  const npv = (r: number) => flows.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i]!, 0);
  let lo = -0.9999;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  // Bisection: slow but sure.
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** The day it ends for the reckoning: the day it was paid out, else today. */
const endOf = (closedAt: string | null, today: string) =>
  closedAt && closedAt <= today ? closedAt : null;

const MONTHS_PER_PERIOD = { monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12 } as const;

/**
 * A fixed deposit: its amount in on the start day; interest paid out each period (payout
 * deposits); the maturity value back on the day it was paid out, or worth today while held.
 */
export function fdFlows(t: DepositTerms, closedAt: string | null, today: string): Flows {
  if (today < t.start) return { flows: [], worth: 0 };
  const closed = endOf(closedAt, today);
  const end = closed ?? today;
  const flows: Flow[] = [{ date: t.start, amount: -t.principal }];
  if (t.interest === 'payout') {
    const step = MONTHS_PER_PERIOD[t.compounding];
    const last = end < t.maturity ? end : t.maturity;
    for (let k = 1; addMonths(t.start, k * step) <= last; k++) {
      flows.push({ date: addMonths(t.start, k * step), amount: payoutPerPeriod(t) });
    }
  }
  const value = depositValue(t, end)!;
  if (closed) return { flows: [...flows, { date: closed, amount: value }], worth: 0 };
  return { flows, worth: value };
}

/** A recurring deposit: each instalment due on its day; paid out or worth today, as above. */
export function rdFlows(t: RecurringTerms, closedAt: string | null, today: string): Flows {
  if (today < t.start) return { flows: [], worth: 0 };
  const closed = endOf(closedAt, today);
  const end = closed ?? today;
  const flows: Flow[] = [];
  for (let k = 0; k < instalmentsDue(t, end); k++) {
    flows.push({ date: addMonths(t.start, k), amount: -t.instalment });
  }
  const value = recurringValue(t, end)!;
  if (closed) return { flows: [...flows, { date: closed, amount: value }], worth: 0 };
  return { flows, worth: value };
}

/**
 * Instant-access savings: the opening amount, then money in and out as linked. Once closed the
 * balance comes back on the closing day; what is linked from that day on is that payout, so it
 * is not counted again.
 */
export function savingsFlows(t: SavingsTerms, closedAt: string | null, today: string): Flows {
  if (today < t.start) return { flows: [], worth: 0 };
  const closed = endOf(closedAt, today);
  const end = closed ?? today;
  const moves = t.movements.filter((m) => (closed ? m.date < closed : m.date <= today));
  const flows: Flow[] = [
    { date: t.start, amount: -t.opening },
    ...[...moves]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({ date: m.date, amount: -m.amount })),
  ].filter((f) => f.amount !== 0);
  const value = savingsValue({ ...t, movements: moves }, end)?.value ?? 0;
  if (closed) return { flows: [...flows, { date: closed, amount: value }], worth: 0 };
  return { flows, worth: value };
}

export type Summary = {
  /** money put in, all told */
  putIn: number;
  /** money back: sales, dividends, interest paid out, withdrawals, deposits paid out */
  takenOut: number;
  /** what is still held, today */
  worth: number;
  gain: number;
  /**
   * the gain over the most money that was in at any one time (basis points): money that goes in
   * and out again (a savings account used as a till, sales put back into the market) is not
   * counted twice
   */
  gainBp: number | null;
  /** the yearly rate (basis points); null when held under three months or without an answer */
  xirrBp: number | null;
  /** held under three months: too short for a yearly rate */
  short: boolean;
  /** the first flow's day */
  since: string | null;
};

export function summarise(flows: Flow[], worth: number, today: string): Summary {
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const putIn = sorted.reduce((s, f) => s + Math.max(0, -f.amount), 0);
  const takenOut = sorted.reduce((s, f) => s + Math.max(0, f.amount), 0);
  const gain = worth + takenOut - putIn;
  let net = 0;
  let peak = 0;
  for (const f of sorted) {
    net -= f.amount;
    peak = Math.max(peak, net);
  }
  const since = sorted[0]?.date ?? null;
  // held from the first flow to today, or to the last flow once nothing is held
  const until = worth !== 0 ? today : (sorted.at(-1)?.date ?? today);
  const short =
    since === null || Date.parse(until) - Date.parse(since) < MIN_XIRR_DAYS * 86_400_000;
  const all = worth !== 0 ? [...sorted, { date: today, amount: worth }] : sorted;
  const rate = short ? null : xirr(all);
  return {
    putIn,
    takenOut,
    worth,
    gain,
    gainBp: peak > 0 ? Math.round((gain * 10_000) / peak) : null,
    xirrBp: rate === null ? null : Math.round(rate * 10_000),
    short,
    since,
  };
}

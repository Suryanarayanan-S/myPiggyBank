/**
 * What a fixed deposit is worth on a day, from its terms: compound interest per period (most
 * Indian banks compound quarterly), simple interest for the days of a period not yet complete,
 * and simple interest only for deposits shorter than six months. Pure; amounts in minor units.
 */

export const COMPOUNDING = ['monthly', 'quarterly', 'half-yearly', 'yearly'] as const;
export type Compounding = (typeof COMPOUNDING)[number];
const PER_YEAR: Record<Compounding, number> = {
  monthly: 12,
  quarterly: 4,
  'half-yearly': 2,
  yearly: 1,
};
/** Banks pay simple interest on deposits shorter than this. */
const SIMPLE_BELOW_DAYS = 181;
const DAY_MS = 86_400_000;

export type DepositTerms = {
  /** minor units */
  principal: number;
  /** yearly rate in basis points (7.25 % = 725) */
  rateBp: number;
  /** YYYY-MM-DD */
  start: string;
  maturity: string;
  compounding: Compounding;
  /** reinvest: interest is added and paid at maturity; payout: paid out each period */
  interest: 'reinvest' | 'payout';
};

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** The same day n months later (the month's last day when it has fewer days). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const months = y * 12 + (m - 1) + n;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Worth on `day` (principal plus interest earned so far); null before it starts. */
export function depositValue(d: DepositTerms, day: string): number | null {
  if (day < d.start) return null;
  if (d.interest === 'payout') return d.principal;
  const to = day < d.maturity ? day : d.maturity;
  const r = d.rateBp / 10_000;
  if (days(d.start, d.maturity) < SIMPLE_BELOW_DAYS) {
    return Math.round(d.principal * (1 + (r * days(d.start, to)) / 365));
  }
  const n = PER_YEAR[d.compounding];
  let periods = 0;
  let from = d.start;
  for (
    let next = addMonths(d.start, 12 / n);
    next <= to;
    next = addMonths(d.start, (12 / n) * (periods + 1))
  ) {
    periods++;
    from = next;
  }
  // Within a period, its share of that period's interest (by the period's own days), so the
  // value never dips when a period completes.
  const next = addMonths(d.start, (12 / n) * (periods + 1));
  const share = days(from, to) / days(from, next);
  return Math.round(d.principal * (1 + r / n) ** periods * (1 + (r / n) * share));
}

/** Paid at maturity. */
export const maturityAmount = (d: DepositTerms) => depositValue(d, d.maturity)!;

/** Interest paid out each period, for deposits that pay it out. */
export const payoutPerPeriod = (d: DepositTerms) =>
  Math.round((d.principal * d.rateBp) / 10_000 / PER_YEAR[d.compounding]);

/** A recurring deposit: the same instalment each month from `start`, for `months` months. */
export type RecurringTerms = {
  /** minor units, each month */
  instalment: number;
  rateBp: number;
  /** YYYY-MM-DD of the first instalment */
  start: string;
  months: number;
  compounding: Compounding;
};

/** Matures a month after the last instalment. */
export const recurringMaturity = (t: RecurringTerms) => addMonths(t.start, t.months);

/** Months from `start` to `day`, with the running month as a share of its days. */
function monthsSince(start: string, day: string): number {
  let m = 0;
  while (addMonths(start, m + 1) <= day) m++;
  const from = addMonths(start, m);
  return m + days(from, day) / days(from, addMonths(start, m + 1));
}

/** Instalments due by `day` (all of them once the last one's day has come). */
export function instalmentsDue(t: RecurringTerms, day: string): number {
  if (day < t.start) return 0;
  let k = 0;
  while (k < t.months && addMonths(t.start, k) <= day) k++;
  return k;
}

/**
 * Worth on `day`: each instalment due so far grows from its own month, compounded like the
 * bank does (quarterly: (1 + r/4) for every three months, fractions included). Null before the
 * first instalment; the maturity amount from maturity on.
 */
export function recurringValue(t: RecurringTerms, day: string): number | null {
  if (day < t.start) return null;
  const maturity = recurringMaturity(t);
  const to = day < maturity ? day : maturity;
  const n = PER_YEAR[t.compounding];
  const growth = 1 + t.rateBp / 10_000 / n;
  const elapsed = monthsSince(t.start, to);
  let value = 0;
  for (let k = 0; k < instalmentsDue(t, to); k++) {
    value += t.instalment * growth ** ((n * (elapsed - k)) / 12);
  }
  return Math.round(value);
}

/** A rate from a day on (instant-access savings change theirs now and then). */
export type RateFrom = { from: string; rateBp: number };

/** The rate on `day`: the last one from that day or before (the first one before them all). */
export function rateOnDay(rates: RateFrom[], day: string): number {
  let rate = rates[0]?.rateBp ?? 0;
  for (const r of rates) if (r.from <= day) rate = r.rateBp;
  return rate;
}

/** The rates with `rateBp` from `day` on: it replaces the rates from that day, kept in order. */
export function withRate(rates: RateFrom[], day: string, rateBp: number): RateFrom[] {
  const kept = rates.filter((r) => r.from < day);
  return kept.length > 0 && rateOnDay(kept, day) === rateBp
    ? kept
    : [...kept, { from: day, rateBp }];
}

/** Instant-access savings: money in and out at any time, interest earned every day. */
export type SavingsTerms = {
  /** minor units, on the start day */
  opening: number;
  /** YYYY-MM-DD: interest is earned from here */
  start: string;
  /** in order of `from` */
  rates: RateFrom[];
  /** when the earned interest is credited (and from then on earns too) */
  compounding: Compounding;
  /** money in (> 0) and out (< 0), each on its day */
  movements: { date: string; amount: number }[];
};

const CREDIT_MONTHS: Record<Compounding, number> = {
  monthly: 1,
  quarterly: 3,
  'half-yearly': 6,
  yearly: 12,
};
/** Interest is credited on the 1st of a month that starts a period (1 Jan, 1 Apr, … quarterly). */
const creditDay = (day: string, c: Compounding) =>
  day.endsWith('-01') && (Number(day.slice(5, 7)) - 1) % CREDIT_MONTHS[c] === 0;

/**
 * Worth on `day` and what has been put in by then (null before it starts): each day earns
 * rate/365 on that day's closing balance; what is earned is credited (rounded to the cent) on the
 * first day of each period, and the interest of the running period is included as it stands.
 */
export function savingsValue(
  t: SavingsTerms,
  day: string,
): { value: number; paidIn: number } | null {
  if (day < t.start) return null;
  const moves = t.movements.filter((m) => m.date <= day);
  const paidIn = t.opening + moves.reduce((s, m) => s + m.amount, 0);
  let balance = t.opening + moves.filter((m) => m.date < t.start).reduce((s, m) => s + m.amount, 0);
  const byDay = new Map<string, number>();
  for (const m of moves) {
    if (m.date >= t.start) byDay.set(m.date, (byDay.get(m.date) ?? 0) + m.amount);
  }
  let earned = 0;
  for (let d = t.start; ; d = nextDay(d)) {
    if (d > t.start && creditDay(d, t.compounding)) {
      balance += Math.round(earned);
      earned = 0;
    }
    balance += byDay.get(d) ?? 0;
    if (d >= day) break;
    earned += (balance * rateOnDay(t.rates, d)) / 10_000 / 365;
  }
  return { value: Math.round(balance + earned), paidIn };
}

const nextDay = (d: string) => new Date(Date.parse(d) + DAY_MS).toISOString().slice(0, 10);

/** Words in a bank line that say money went into (or came out of) a deposit. */
const DEPOSIT_WORDS =
  /\b(fd|rd|fixed|recurring|deposits?|festgeld\w*|tagesgeld\w*|sparen|spar\w*|savings?|sweep)\b/i;

/**
 * How likely a payment belongs to a deposit: the same amount (3), words that say deposit or the
 * deposit's name (2), from its account (1), within a week of its start (1). 3 or more is a
 * suggestion.
 */
export function matchScore(
  d: { name: string; accountId: string | null; amount: number | null; start: string },
  t: { accountId: string | null; amount: number; date: string; text: string },
): number {
  const text = t.text.toLowerCase();
  const named = d.name.trim().length >= 3 && text.includes(d.name.trim().toLowerCase());
  return (
    (d.amount !== null && d.amount > 0 && t.amount === d.amount ? 3 : 0) +
    (named || DEPOSIT_WORDS.test(text) ? 2 : 0) +
    (d.accountId !== null && t.accountId === d.accountId ? 1 : 0) +
    (Math.abs(Date.parse(t.date) - Date.parse(d.start)) <= 7 * DAY_MS ? 1 : 0)
  );
}

/** The word a deposit's name ends with, so the kind shows wherever the name does. */
export const KIND_SUFFIX = { fd: 'FD', rd: 'RD', savings: 'Instant' } as const;

/** Whether the name already says its kind as a word anywhere ("HDFC FD 2026"). */
const saysKind = (name: string, kind: keyof typeof KIND_SUFFIX) =>
  new RegExp(`(^|\\s)${KIND_SUFFIX[kind]}(\\s|$)`, 'i').test(name);

/** The name without the kind added at its end, for matching it in bank lines. */
export const withoutKindSuffix = (name: string, kind: keyof typeof KIND_SUFFIX) =>
  name.trim().replace(new RegExp(`\\s+${KIND_SUFFIX[kind]}$`, 'i'), '');

/** "HDFC" → "HDFC FD" (unless it already says FD), within 60 characters. */
export function withKindSuffix(name: string, kind: keyof typeof KIND_SUFFIX): string {
  const base = name.trim();
  const suffix = KIND_SUFFIX[kind];
  if (saysKind(base, kind)) return base;
  if (
    base.toLowerCase().endsWith(` ${suffix.toLowerCase()}`) ||
    base.toLowerCase() === suffix.toLowerCase()
  )
    return base;
  return `${base.slice(0, 60 - suffix.length - 1).trimEnd()} ${suffix}`;
}

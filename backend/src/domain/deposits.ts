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

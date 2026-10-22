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

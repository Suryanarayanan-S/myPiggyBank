import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useViewCurrency, withView } from './viewCurrency';

export const COMPOUNDING = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'half-yearly': 'Half-yearly',
  yearly: 'Yearly',
} as const;
export type Compounding = keyof typeof COMPOUNDING;

export type Deposit = {
  id: string;
  kind: 'fd' | 'rd' | 'savings';
  name: string;
  currency: string;
  ownerMemberId: string | null;
  accountId: string | null;
  /** how net worth counts it */
  assetClass: 'liquid' | 'property' | 'investment' | 'other';
  /** put in: a fixed deposit's amount; a recurring one's instalments due so far; savings: the
   * opening amount plus money in less money out */
  principal: number;
  /** savings: the amount on the start day */
  opening: number | null;
  /** today's rate */
  rateBp: number;
  startDate: string;
  /** null for instant-access savings */
  maturityDate: string | null;
  compounding: Compounding;
  interest: 'reinvest' | 'payout';
  closedAt: string | null;
  note: string | null;
  /** worth today; null once paid out or before it starts */
  value: number | null;
  interestEarned: number | null;
  maturityAmount: number | null;
  payoutPerPeriod: number | null;
  /** recurring deposits: the monthly instalment, for how many months, how many due so far */
  instalment: number | null;
  months: number | null;
  instalmentsDue: number | null;
  /** booked from the account each month, in this category */
  book: { categoryId: string | null } | null;
  /** savings: the rate from each day on */
  rates: { from: string; rateBp: number }[] | null;
  /** linked transactions, newest first: money in (> 0) and back out (< 0) */
  movements: Movement[];
  daysLeft: number | null;
  status: 'upcoming' | 'active' | 'matured' | 'closed';
  /** value and principal in the summary currency; null without an exchange rate or when closed */
  inView: { value: number; principal: number } | null;
};
/** The word a deposit's name ends with (the server adds it when saving). */
export const KIND_SUFFIX = { fd: 'FD', rd: 'RD', savings: 'Instant' } as const;

/** "HDFC" → "HDFC FD" (unless it already says FD), within 60 characters — as the server saves it. */
export function withKindSuffix(name: string, kind: Deposit['kind']): string {
  const base = name.trim();
  const suffix = KIND_SUFFIX[kind];
  if (new RegExp(`(^|\\s)${suffix}(\\s|$)`, 'i').test(base)) return base;
  return `${base.slice(0, 60 - suffix.length - 1).trimEnd()} ${suffix}`;
}

export type Movement = {
  transactionId: string;
  date: string;
  amount: number;
  label: string | null;
};
export const KIND_LABEL = {
  fd: 'fixed deposit',
  rd: 'recurring deposit',
  savings: 'instant-access account',
} as const;

/** "2 fixed deposits, 1 recurring deposit" */
export function depositCount(list: { kind: Deposit['kind'] }[]): string {
  return (['fd', 'rd', 'savings'] as const)
    .map((k) => [k, list.filter((d) => d.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${KIND_LABEL[k]}${n === 1 ? '' : 's'}`)
    .join(', ');
}

export type DepositsResponse = {
  deposits: Deposit[];
  summary: {
    currency: string;
    value: number;
    principal: number;
    unconverted: { currency: string; amount: number }[];
  };
};

/** The family's deposits, totals in the "Show in" currency. */
export function useDeposits() {
  const [view] = useViewCurrency();
  return useQuery({
    queryKey: ['deposits', view],
    queryFn: () => api.get<DepositsResponse>(withView('/deposits', view)),
  });
}

/** 7.25 % from basis points. */
export const formatRateBp = (bp: number) =>
  `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} %`;

/** "7.25" / "7,25" / "7.25 %" → 725 basis points; null unless above 0 and at most 50 %. */
export function parseRatePercent(input: string): number | null {
  const s = input.replace('%', '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp > 0 && bp <= 5_000 ? bp : null;
}

type Maturing = Deposit & { daysLeft: number; maturityDate: string; maturityAmount: number };

/** Open deposits maturing within `days` (or already matured, not yet paid out), soonest first. */
export const maturingSoon = (deposits: Deposit[], days = 60) =>
  deposits
    .filter(
      (d): d is Maturing =>
        (d.status === 'active' || d.status === 'matured') &&
        d.daysLeft !== null &&
        d.daysLeft <= days,
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);

/** When a matured deposit was paid out: the day its money came back (a linked income), else
 * its maturity, or today if that is still to come. */
export function paidOutOn(d: Deposit, today: string): string {
  const back = d.movements.find((m) => m.amount < 0);
  if (back) return back.date;
  return d.maturityDate && d.maturityDate < today ? d.maturityDate : today;
}

/** Deposits a transaction can be linked to: open ones in its currency (and the one it has, if
 * still in its currency). */
export const linkableDeposits = (deposits: Deposit[], currency: string, current?: string | null) =>
  deposits.filter((d) => d.currency === currency && (d.id === current || d.status !== 'closed'));

export const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "in 12 days" / "today" / "3 days ago". */
export const whenLeft = (daysLeft: number) =>
  daysLeft === 0
    ? 'today'
    : daysLeft === 1
      ? 'tomorrow'
      : daysLeft > 0
        ? `in ${daysLeft} days`
        : `${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`;

/** An unlinked income or payment that may belong to a deposit. */
export type Candidate = {
  id: string;
  date: string;
  type: 'income' | 'expense';
  amount: number;
  accountId: string | null;
  accountName: string | null;
  text: string | null;
  /** likely (same amount, deposit words, its account, near its start) */
  suggested: boolean;
};

/** For a deposit (`depositId`), or one being added (`currency`, `accountId`). */
export function useCandidates(
  params: { depositId?: string; currency?: string; accountId?: string; q?: string },
  enabled = true,
) {
  const search = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  return useQuery({
    queryKey: ['deposit-candidates', search],
    queryFn: () => api.get<{ items: Candidate[] }>(`/deposits/candidates?${search}`),
    enabled,
  });
}

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
  kind: 'fd' | 'rd';
  name: string;
  currency: string;
  ownerMemberId: string | null;
  accountId: string | null;
  /** how net worth counts it */
  assetClass: 'liquid' | 'property' | 'investment' | 'other';
  /** put in: a fixed deposit's amount; a recurring one's instalments due so far */
  principal: number;
  rateBp: number;
  startDate: string;
  maturityDate: string;
  compounding: Compounding;
  interest: 'reinvest' | 'payout';
  closedAt: string | null;
  note: string | null;
  /** worth today; null once paid out or before it starts */
  value: number | null;
  interestEarned: number | null;
  maturityAmount: number;
  payoutPerPeriod: number | null;
  /** recurring deposits: the monthly instalment, for how many months, how many due so far */
  instalment: number | null;
  months: number | null;
  instalmentsDue: number | null;
  /** booked from the account each month, in this category */
  book: { categoryId: string | null } | null;
  daysLeft: number;
  status: 'upcoming' | 'active' | 'matured' | 'closed';
  /** value and principal in the summary currency; null without an exchange rate or when closed */
  inView: { value: number; principal: number } | null;
};
export const KIND_LABEL = { fd: 'fixed deposit', rd: 'recurring deposit' } as const;

/** "2 fixed deposits, 1 recurring deposit" */
export function depositCount(list: { kind: Deposit['kind'] }[]): string {
  return (['fd', 'rd'] as const)
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

/** Open deposits maturing within `days` (or already matured, not yet paid out), soonest first. */
export const maturingSoon = (deposits: Deposit[], days = 60) =>
  deposits
    .filter((d) => (d.status === 'active' || d.status === 'matured') && d.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft);

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

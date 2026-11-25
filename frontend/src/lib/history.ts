import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from './api';
import { useViewCurrency, withView } from './viewCurrency';

/** How far back a value-over-time chart looks. */
export type Range = '1m' | '6m' | '1y' | 'all';
export const RANGES: { key: Range; label: string; long: string }[] = [
  { key: '1m', label: '1M', long: 'last month' },
  { key: '6m', label: '6M', long: 'last 6 months' },
  { key: '1y', label: '1Y', long: 'last year' },
  { key: 'all', label: 'All', long: 'since the start' },
];
const RANGE_KEY = 'pb-chart-range';

/** The range chosen on any chart, remembered on this browser (default: a year). */
export function useRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState<Range>(() => {
    try {
      const r = localStorage.getItem(RANGE_KEY);
      return RANGES.some((x) => x.key === r) ? (r as Range) : '1y';
    } catch {
      return '1y';
    }
  });
  const choose = useCallback((r: Range) => {
    setRange(r);
    try {
      localStorage.setItem(RANGE_KEY, r);
    } catch {
      // storage blocked: the choice holds for this page
    }
  }, []);
  return [range, choose];
}

export type InvestmentPart = 'market' | 'fd' | 'rd' | 'savings' | 'gold';
export type InvestmentHistory = {
  currency: string;
  days: string[];
  total: number[];
  parts: Partial<Record<InvestmentPart, number[]>>;
  deposits: { id: string; values: number[] }[];
};
export type AccountsHistory = {
  currency: string;
  days: string[];
  total: number[];
  accounts: { id: string; currency: string; values: number[] }[];
  unconverted: string[];
};

const withRange = (path: string, range: Range, view: ReturnType<typeof useViewCurrency>[0]) =>
  withView(`${path}?range=${range}`, view);

export function useInvestmentHistory(range: Range) {
  const [view] = useViewCurrency();
  return useQuery({
    queryKey: ['investment-history', view, range],
    queryFn: () => api.get<InvestmentHistory>(withRange('/investments/history', range, view)),
    // switching the range keeps the old line until the new one is there
    placeholderData: keepPreviousData,
  });
}

/** `currency`: this one rather than the chosen view (the dashboard's spending currency). */
export function useAccountsHistory(range: Range, currency?: string) {
  const [chosen] = useViewCurrency();
  const view = (currency as typeof chosen | undefined) ?? chosen;
  return useQuery({
    // under 'accounts', so whatever refreshes the accounts refreshes this too
    queryKey: ['accounts', 'history', view, range],
    queryFn: () => api.get<AccountsHistory>(withRange('/accounts/history', range, view)),
    placeholderData: keepPreviousData,
  });
}

export type NetWorthHistory = {
  currency: string;
  days: string[];
  total: number[];
  /** past entries typed in from before the app's first day, oldest first */
  earlier: { date: string; value: number }[];
};

/** Net worth day by day, worked out from what the app knows (nothing to save). */
export function useNetWorthHistory(range: Range) {
  const [view] = useViewCurrency();
  return useQuery({
    // under 'net-worth', so whatever refreshes the net worth refreshes this too
    queryKey: ['net-worth', 'history', view, range],
    queryFn: () => api.get<NetWorthHistory>(withRange('/net-worth/history', range, view)),
    placeholderData: keepPreviousData,
  });
}

/** The points of a net-worth history: the past entries, then every worked-out day. */
export const netWorthPoints = (h: NetWorthHistory) => [
  ...h.earlier,
  ...h.days.map((date, i) => ({ date, value: h.total[i]! })),
];

/** Several series added day by day (missing ones count as nothing). */
export const addSeries = (length: number, series: (number[] | undefined)[]) =>
  Array.from({ length }, (_, i) => series.reduce((t, s) => t + (s?.[i] ?? 0), 0));

/**
 * From where there was something: leading zeros are cut, keeping the last zero day so the line
 * starts from nothing where it began (a year's chart of money put in three months ago shows
 * three months). Nothing at all: as given.
 */
export function fromFirstValue<T>(items: T[], value: (t: T) => number): T[] {
  const first = items.findIndex((t) => value(t) !== 0);
  return first <= 0 ? items : items.slice(first - 1);
}

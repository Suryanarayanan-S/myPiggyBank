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

/** Several series added day by day (missing ones count as nothing). */
export const addSeries = (length: number, series: (number[] | undefined)[]) =>
  Array.from({ length }, (_, i) => series.reduce((t, s) => t + (s?.[i] ?? 0), 0));

/**
 * The points of a range from dated values (e.g. snapshots): those inside it, then today's. The
 * last value before the range starts it off (on its first day), so a year with no snapshot in it
 * still draws from where it stood.
 */
export function pointsIn(
  points: { date: string; value: number }[],
  from: string | null,
  today: { date: string; value: number },
) {
  const sorted = points
    .filter((p) => p.date < today.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (from === null) return [...sorted, today];
  const before = sorted.filter((p) => p.date < from).at(-1);
  const inside = sorted.filter((p) => p.date >= from);
  return [
    ...(before && inside[0]?.date !== from ? [{ date: from, value: before.value }] : []),
    ...inside,
    today,
  ];
}

/** The first day of a range ending today (null: since the start). */
export function rangeFrom(range: Range, today: string): string | null {
  if (range === 'all') return null;
  const back = range === '1m' ? 1 : range === '6m' ? 6 : 12;
  // the same day that many months back, or that month's last day (as the server counts)
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const months = y * 12 + (m - 1) - back;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * From where there was something: leading zeros are cut, keeping the last zero day so the line
 * starts from nothing where it began (a year's chart of money put in three months ago shows
 * three months). Nothing at all: as given.
 */
export function fromFirstValue<T>(items: T[], value: (t: T) => number): T[] {
  const first = items.findIndex((t) => value(t) !== 0);
  return first <= 0 ? items : items.slice(first - 1);
}

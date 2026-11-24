/**
 * The days a value-over-time line is drawn on: a range back from today (one month, six months,
 * a year, or everything since the first day anything was there), at most about 200 points so a
 * long history stays light. Pure.
 */
import { z } from 'zod';

export const RANGES = ['1m', '6m', '1y', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const RangeQuery = z.object({ range: z.enum(RANGES).default('1y') });

const DAY = 86_400_000;
const MAX_POINTS = 200;
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const plus = (day: string, n: number) =>
  new Date(Date.parse(day) + n * DAY).toISOString().slice(0, 10);
/** The same day n months earlier, or that month's last day (31 Mar − 1 month = 28 Feb). */
const monthsBack = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const months = y * 12 + (m - 1) - n;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

/** The start of a range ending today; for "all", the first day (a year back when unknown). */
export function rangeStart(range: Range, today: string, first: string | null): string {
  if (range === '1m') return monthsBack(today, 1);
  if (range === '6m') return monthsBack(today, 6);
  if (range === '1y') return monthsBack(today, 12);
  return first && first < today ? first : monthsBack(today, 12);
}

/** Evenly spaced days from `start` to today, today always the last. */
export function dayGrid(start: string, today: string): string[] {
  const days = Math.max(0, span(start, today));
  const step = Math.max(1, Math.ceil(days / MAX_POINTS));
  const grid: string[] = [];
  for (let k = days % step; k <= days; k += step) grid.push(plus(start, k));
  if (grid[0] !== start && days > 0) grid.unshift(start);
  return grid;
}

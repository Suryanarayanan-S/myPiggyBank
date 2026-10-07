import { shiftMonth } from './months';

export type Preset =
  'this-month' | 'last-month' | 'last-3' | 'this-year' | 'last-12' | 'all' | 'custom';
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3', label: 'Last 3 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-12', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];
const MAX_MONTHS = 120;

/** Month range for a preset; `today` is the current local month ("YYYY-MM"). */
export function periodRange(
  preset: Preset,
  today: string,
  firstMonth: string | null,
  custom?: { from: string; to: string },
): { from: string; to: string } {
  let from = today;
  let to = today;
  switch (preset) {
    case 'last-month':
      from = to = shiftMonth(today, -1);
      break;
    case 'last-3':
      from = shiftMonth(today, -2);
      break;
    case 'this-year':
      from = `${today.slice(0, 4)}-01`;
      break;
    case 'last-12':
      from = shiftMonth(today, -11);
      break;
    case 'all':
      from = firstMonth && firstMonth < today ? firstMonth : today;
      break;
    case 'custom':
      if (custom)
        [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
      break;
  }
  const earliest = shiftMonth(to, -(MAX_MONTHS - 1));
  return { from: from < earliest ? earliest : from, to };
}

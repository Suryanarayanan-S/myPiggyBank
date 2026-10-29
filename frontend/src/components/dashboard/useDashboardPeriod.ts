import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../../lib/api';
import type { Dashboard } from '../../lib/dashboardTypes';
import { isMonth, localMonth, monthTitle } from '../../lib/months';
import { PRESETS, periodRange, type Preset } from '../../lib/periods';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

/**
 * The period chosen in the address (?period=…, or from/to for a custom one; the last 12 months
 * when none) and the dashboard figures for it — shared by the Dashboard and Spending → Overview, so
 * the two load them once.
 */
export function useDashboardPeriod() {
  const [params, setParams] = useSearchParams();
  const today = localMonth();
  const [view] = useViewCurrency();
  const preset = (
    PRESETS.some((p) => p.value === params.get('period')) ? params.get('period') : 'last-12'
  ) as Preset;
  const custom = {
    from: isMonth(params.get('from')) ? params.get('from')! : today,
    to: isMonth(params.get('to')) ? params.get('to')! : today,
  };
  // "All time" needs the first recorded month, which the API returns with every response.
  const first = useQuery({
    queryKey: ['dashboard', 'first'],
    queryFn: () => api.get<Dashboard>(`/dashboard?from=${today}&to=${today}`),
    select: (d) => d.firstMonth,
    enabled: preset === 'all',
  });
  const range = periodRange(preset, today, first.data ?? null, custom);
  const dash = useQuery({
    queryKey: ['dashboard', range.from, range.to, view],
    queryFn: () =>
      api.get<Dashboard>(withView(`/dashboard?from=${range.from}&to=${range.to}`, view)),
    placeholderData: keepPreviousData,
    enabled: preset !== 'all' || first.isSuccess,
  });
  // a new period keeps the rest of the address (e.g. the month the other Spending tabs show)
  const change = (p: Preset, c?: { from: string; to: string }) => {
    const next = new URLSearchParams(params);
    for (const k of ['period', 'from', 'to']) next.delete(k);
    next.set('period', p);
    if (p === 'custom' && c) {
      next.set('from', c.from);
      next.set('to', c.to);
    }
    setParams(next, { replace: true });
  };
  const label =
    range.from === range.to
      ? monthTitle(range.from)
      : `${monthTitle(range.from)} – ${monthTitle(range.to)}`;
  return { today, view, preset, custom, range, dash, change, label };
}

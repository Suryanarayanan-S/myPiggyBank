import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMe } from '../../auth/auth';
import { Button } from '../ui/Button';
import { FormError } from '../ui/Field';
import { api } from '../../lib/api';

type Status = {
  asOf: string | null;
  fetchedAt: string | null;
  updated: number;
  notFound: string[];
  lastError: string | null;
  warning: string | null;
  /** shares outside India (onvista) and the euro markets */
  world?: {
    fetchedAt: string | null;
    updated: number;
    notFound: string[];
    lastError: string | null;
  };
};
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** Opt-in daily closing prices from NSE's public end-of-day file, with what the last run did. */
export function LivePrices() {
  const me = useMe();
  const queryClient = useQueryClient();
  const on = me.data?.family.livePrices ?? false;
  const status = useQuery({
    queryKey: ['holdings', 'live-prices'],
    queryFn: () => api.get<Status>('/holdings/live-prices'),
    enabled: on,
  });
  // New prices change values everywhere (investments, net worth, goals).
  const refresh = () => queryClient.invalidateQueries();
  const update = useMutation({
    mutationFn: () => api.post<Status>('/holdings/live-prices/refresh'),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: (livePrices: boolean) => api.put('/family', { livePrices }),
    onSuccess: async (_d, livePrices) => {
      await refresh();
      if (livePrices) update.mutate();
    },
  });
  // The status query is refetched after every update, so it is always the newest word.
  const s = status.data ?? update.data;
  // Shows the new state at once while it is saved.
  const checked = toggle.isPending ? !!toggle.variables : on;

  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
            aria-describedby="live-prices-hint"
          />
          Daily closing prices from NSE
        </label>
        {on && (
          <Button
            variant="ghost"
            className="!py-1"
            disabled={update.isPending}
            onClick={() => update.mutate()}
          >
            <RefreshCw size={14} aria-hidden className={update.isPending ? 'animate-spin' : ''} />
            {update.isPending ? 'Updating…' : 'Update now'}
          </Button>
        )}
      </div>
      <p id="live-prices-hint" className="text-xs text-slate-500" aria-live="polite">
        {!on
          ? 'Downloads NSE’s public end-of-day file each evening, and onvista’s closes for shares outside India (only public ISINs are sent, nothing about you). Quantities still come from your imports.'
          : s?.lastError
            ? `Could not update: ${s.lastError}. The last prices are kept.`
            : s?.asOf
              ? `Closing prices of ${dayLabel(s.asOf)} saved for ${s.updated} holdings${
                  s.notFound.length ? ` · not on NSE (price kept): ${s.notFound.join(', ')}` : ''
                }`
              : 'Checked every few hours.'}
      </p>
      {on && s?.warning && !s.lastError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{s.warning}</p>
      )}
      {on && s?.world && (s.world.updated > 0 || s.world.notFound.length > 0) && (
        <p className="text-xs text-slate-500">
          Shares outside India: closes saved for {s.world.updated}
          {s.world.notFound.length
            ? ` · not quoted on onvista (price kept): ${s.world.notFound.join(', ')}`
            : ''}
        </p>
      )}
      {on && s?.world?.lastError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{s.world.lastError}</p>
      )}
      <FormError error={toggle.error ?? update.error} />
    </div>
  );
}

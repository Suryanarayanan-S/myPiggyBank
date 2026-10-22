import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { FormError } from '../ui/Field';
import { api } from '../../lib/api';
import { dayLabel } from '../../lib/deposits';
import { formatMoney } from '../../lib/money';

type Status = {
  checkedOn: string | null;
  running: boolean;
  /** in the daily run (the family has NSE prices on) */
  daily: boolean;
  /** this server can reach NSE */
  available: boolean;
  failed: string[];
  problem: string | null;
};
type Result = { added: number; amount: number };

const STATUS = ['holdings', 'dividend-check'];

/** Checks now (after one already running); afterwards the holdings show what was added. */
export function checkDividends(queryClient: QueryClient) {
  const run = api.post<Result>('/holdings/dividend-check');
  // the status shows "checking" while it runs
  void queryClient.invalidateQueries({ queryKey: STATUS });
  return run.finally(() => queryClient.invalidateQueries({ queryKey: ['holdings'] }));
}

/**
 * Dividends and gold bond interest come from NSE's history by themselves, each day after the
 * prices; this says when they were last checked, and can check now.
 */
export function DividendCheck({ empty }: { empty: boolean }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: STATUS,
    queryFn: () => api.get<Status>('/holdings/dividend-check'),
    // while a check runs (here or from the daily run), look again until it is done
    refetchInterval: (q) => (q.state.data?.running ? 3_000 : false),
  });
  const now = useMutation({ mutationFn: () => checkDividends(queryClient) });
  const s = status.data;
  const running = now.isPending || !!s?.running;
  if (s && !s.available) {
    return (
      <p className="text-sm text-slate-500">
        This server is not set up to reach NSE, so dividends and gold bond interest are not worked
        out; enter them under each holding’s Trades.
      </p>
    );
  }
  const when = s?.daily ? 'each day' : 'when asked (switch on NSE prices to check each day)';
  return (
    <div className="space-y-1 text-sm text-slate-500">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite">
          {running
            ? 'Checking dividends and gold bond interest on NSE… (up to two minutes the first time)'
            : empty && !s?.checkedOn
              ? `Dividends, gold bond interest, splits and mergers are worked out from NSE’s history ${when}. Not checked yet.`
              : `Dividends and gold bond interest are checked on NSE ${when}${
                  s?.checkedOn ? ` · last ${dayLabel(s.checkedOn)}` : ''
                }${now.data ? ` · ${now.data.added} added (${formatMoney(now.data.amount, 'INR')})` : ''}.`}
        </p>
        <Button
          variant="secondary"
          className="!py-1"
          disabled={running}
          onClick={() => now.mutate()}
        >
          <RefreshCw size={14} aria-hidden /> Check now
        </Button>
      </div>
      {s?.problem && (
        <p role="alert" className="text-amber-800 dark:text-amber-300">
          NSE did not answer as expected ({s.problem}). It is tried again with the next prices.
        </p>
      )}
      {s && s.failed.length > 0 && !s.problem && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          No history on NSE for {s.failed.join(', ')} (listed on BSE only, or renamed): their
          dividends are not included.
        </p>
      )}
      <FormError error={now.error} />
    </div>
  );
}

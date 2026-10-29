import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, Copy, PencilLine, SlidersHorizontal } from 'lucide-react';
import { useMe } from '../auth/auth';
import { BucketBars } from '../components/budget/BucketBars';
import { CategoryLimits } from '../components/budget/CategoryLimits';
import { SummaryCards } from '../components/budget/SummaryCards';
import { TargetsForm } from '../components/budget/TargetsForm';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { MonthNav } from '../components/ui/MonthNav';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { isMonth, localMonth } from '../lib/months';
import type { MonthSummary } from '../lib/types';
import { useViewCurrency, withView } from '../lib/viewCurrency';

export function BudgetPage() {
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get('month')) ? params.get('month')! : localMonth();
  const me = useMe();
  const queryClient = useQueryClient();
  const [editTargets, setEditTargets] = useState(false);
  const [view] = useViewCurrency();

  const summary = useQuery({
    queryKey: ['budget', month, view],
    queryFn: () => api.get<MonthSummary>(withView(`/budget/${month}`, view)),
  });
  const copy = useMutation({
    mutationFn: () => api.post<MonthSummary>(`/budget/${month}/copy-previous`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget', month] }),
  });
  const s = summary.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} onChange={(m) => setParams({ month: m }, { replace: true })} />
        <Link
          to={`/spending/entry?month=${month}`}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <PencilLine size={16} aria-hidden /> Quick entry
        </Link>
      </div>

      <FormError error={summary.error} />
      {summary.isPending && <p className="text-sm text-slate-500">Loading…</p>}

      {s && (
        <>
          {s.unconverted.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {s.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' and ')} could
                  not be converted to {s.currency} — there is no exchange rate for this or an
                  earlier month. These amounts are left out of the totals.{' '}
                  <Link to="/settings" className="font-medium underline">
                    Add a rate in Settings
                  </Link>
                  .
                </span>
              </p>
            </Card>
          )}
          <SummaryCards s={s} />
          <BucketBars
            s={s}
            actions={
              <Button variant="ghost" onClick={() => setEditTargets(true)}>
                <SlidersHorizontal size={16} aria-hidden /> Edit targets
              </Button>
            }
          />
          <FormError error={copy.error} />
          <CategoryLimits
            s={s}
            actions={
              s.limitsEditable && (
                <Button variant="ghost" disabled={copy.isPending} onClick={() => copy.mutate()}>
                  <Copy size={16} aria-hidden /> Copy last month’s limits
                </Button>
              )
            }
          />
        </>
      )}

      {editTargets && me.data && (
        <Modal title="Bucket targets" onClose={() => setEditTargets(false)}>
          <TargetsForm family={me.data.family} onDone={() => setEditTargets(false)} />
        </Modal>
      )}
    </div>
  );
}

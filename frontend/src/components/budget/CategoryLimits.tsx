import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Progress } from '../ui/Progress';
import { api } from '../../lib/api';
import { formatMoney, parseMoneyInput } from '../../lib/money';
import { BUCKETS, type Bucket, type CategorySummary, type MonthSummary } from '../../lib/types';

const asInput = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

export function CategoryLimits({ s, actions }: { s: MonthSummary; actions?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (limit: { categoryId: string; amount: number | null }) =>
      api.put<MonthSummary>(`/budget/${s.month}/limits`, { limits: [limit] }),
    onSuccess: (data) => queryClient.setQueryData(['budget', s.month], data),
  });
  const groups: { title: string; rows: CategorySummary[] }[] = [
    ...(Object.keys(BUCKETS) as Bucket[]).map((b) => ({
      title: BUCKETS[b],
      rows: s.categories.filter((c) => c.kind === 'expense' && c.bucket === b),
    })),
    { title: 'Uncategorised', rows: s.categories.filter((c) => c.categoryId === null) },
  ].filter((g) => g.rows.length > 0);

  return (
    <Card title="Categories" actions={actions}>
      <p className="mb-3 text-sm text-slate-500">
        Optional monthly limits in {s.currency}. Leave empty for no limit.
      </p>
      <FormError error={save.error} />
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {g.title}
            </h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.rows.map((c) => (
                <li
                  key={c.categoryId ?? 'none'}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[minmax(8rem,1fr)_7rem_8rem_minmax(6rem,10rem)]"
                >
                  <span className="truncate text-sm">{c.name}</span>
                  <span className="text-right text-sm font-medium tabular-nums">
                    {formatMoney(c.actual, s.currency)}
                  </span>
                  {c.categoryId ? (
                    <input
                      aria-label={`Limit for ${c.name}`}
                      inputMode="decimal"
                      placeholder="No limit"
                      defaultValue={asInput(c.limit)}
                      key={`${s.month}-${c.limit}`}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm tabular-nums placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
                      onBlur={(e) => {
                        const text = e.target.value.trim();
                        const amount = text === '' ? null : parseMoneyInput(text);
                        if (text !== '' && (amount === null || amount <= 0)) {
                          e.target.value = asInput(c.limit);
                          return;
                        }
                        if (amount !== c.limit) save.mutate({ categoryId: c.categoryId!, amount });
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  {c.limit !== null ? (
                    <div className="col-span-2 sm:col-span-1">
                      <Progress
                        label={`${c.name} used of limit`}
                        value={(c.usedBp ?? 0) / 10_000}
                        tone={c.over ? 'bad' : (c.usedBp ?? 0) > 8000 ? 'warn' : 'ok'}
                      />
                      <p
                        className={clsx(
                          'mt-0.5 text-xs tabular-nums',
                          c.over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500',
                        )}
                      >
                        {c.over
                          ? `${formatMoney(-c.remaining!, s.currency)} over`
                          : `${formatMoney(c.remaining!, s.currency)} left`}
                      </p>
                    </div>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

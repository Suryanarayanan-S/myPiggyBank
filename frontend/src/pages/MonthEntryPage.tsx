import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Check } from 'lucide-react';
import { useMe } from '../auth/auth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, FormError } from '../components/ui/Field';
import { MonthNav } from '../components/ui/MonthNav';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import { formatMoney, parseMoneyInput } from '../lib/money';
import { isMonth, localMonth } from '../lib/months';
import { useAccounts } from '../lib/queries';
import { BUCKETS, type Bucket, type MonthEntry } from '../lib/types';

const asInput = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

export function MonthEntryPage() {
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get('month')) ? params.get('month')! : localMonth();
  const me = useMe();
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const spending = me.data?.family.spendingCurrency;
  const accountId =
    params.get('accountId') ?? (active.find((a) => a.currency === spending) ?? active[0])?.id ?? '';

  const entry = useQuery({
    queryKey: ['month-entry', month, accountId],
    queryFn: () => api.get<MonthEntry>(`/month-entry/${month}?accountId=${accountId}`),
    enabled: !!accountId,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (entry.data) {
      setValues(Object.fromEntries(entry.data.rows.map((r) => [r.categoryId, asInput(r.amount)])));
    }
  }, [entry.data]);

  const rows = useMemo(() => entry.data?.rows ?? [], [entry.data]);
  const currency = entry.data?.currency ?? spending ?? 'EUR';
  const parsed = useMemo(
    () =>
      Object.fromEntries(
        rows.map((r) => {
          const text = (values[r.categoryId] ?? '').trim();
          return [r.categoryId, text === '' ? null : parseMoneyInput(text)];
        }),
      ) as Record<string, number | null>,
    [rows, values],
  );
  const invalid = rows.filter((r) => {
    const text = (values[r.categoryId] ?? '').trim();
    const v = parsed[r.categoryId];
    return text !== '' && (v === null || v === undefined || v <= 0);
  });
  const changed = rows.filter(
    (r) => !invalid.includes(r) && (parsed[r.categoryId] ?? null) !== r.amount,
  );
  const dirty = changed.length > 0;

  const sum = (pred: (r: MonthEntry['rows'][number]) => boolean) =>
    rows.filter(pred).reduce((s, r) => s + (parsed[r.categoryId] ?? 0), 0);
  const income = sum((r) => r.kind === 'income');
  const byBucket = (b: Bucket) => sum((r) => r.bucket === b);
  const unused = income - byBucket('essentials') - byBucket('fun') - byBucket('future');

  const save = useMutation({
    mutationFn: () =>
      api.put<MonthEntry>(`/month-entry/${month}`, {
        accountId,
        entries: changed.map((r) => ({
          categoryId: r.categoryId,
          amount: parsed[r.categoryId] ?? null,
        })),
      }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['month-entry', month, accountId], data);
      await Promise.all(
        ['budget', 'transactions', 'accounts'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      );
    },
  });

  const navigate = (patch: Record<string, string>) => {
    if (dirty && !window.confirm('You have unsaved amounts. Leave without saving?')) return;
    setParams({ month, ...(accountId && { accountId }), ...patch }, { replace: true });
  };

  const groups: { title: string; filter: (r: MonthEntry['rows'][number]) => boolean }[] = [
    { title: 'Income', filter: (r) => r.kind === 'income' },
    ...(Object.keys(BUCKETS) as Bucket[]).map((b) => ({
      title: BUCKETS[b],
      filter: (r: MonthEntry['rows'][number]) => r.bucket === b,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} onChange={(m) => navigate({ month: m })} />
        <Link
          to={`/budget?month=${month}`}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
        >
          <ArrowLeft size={16} aria-hidden /> Back to budget
        </Link>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-[minmax(12rem,20rem)_1fr] sm:items-end">
          <Field label="Monthly totals for account" htmlFor="entry-account">
            <Select
              id="entry-account"
              value={accountId}
              onChange={(e) => navigate({ accountId: e.target.value })}
            >
              {active.length === 0 && <option value="">Add an account first</option>}
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-sm text-slate-500">
            Type one total per category for the month, like your spreadsheet. Individual
            transactions you add elsewhere count on top.
          </p>
        </div>
      </Card>

      <FormError error={entry.error} />

      {entry.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-5"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            {groups.map((g) => {
              const groupRows = rows.filter(g.filter);
              return (
                <Card
                  key={g.title}
                  title={g.title}
                  actions={
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(sum(g.filter), currency)}
                    </span>
                  }
                >
                  <ul className="space-y-2">
                    {groupRows.map((r) => (
                      <li
                        key={r.categoryId}
                        className="grid grid-cols-[1fr_9rem] items-center gap-3"
                      >
                        <label htmlFor={`amt-${r.categoryId}`} className="min-w-0 text-sm">
                          <span className="block truncate">{r.name}</span>
                          {r.otherTransactions > 0 && (
                            <span className="block text-xs text-slate-400">
                              + {r.otherTransactions} individual transaction
                              {r.otherTransactions > 1 ? 's' : ''}
                            </span>
                          )}
                        </label>
                        <input
                          id={`amt-${r.categoryId}`}
                          inputMode="decimal"
                          placeholder="0,00"
                          value={values[r.categoryId] ?? ''}
                          onChange={(e) => setValues({ ...values, [r.categoryId]: e.target.value })}
                          aria-invalid={invalid.includes(r)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-right text-sm tabular-nums placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none aria-[invalid=true]:border-rose-500 dark:border-slate-700 dark:bg-slate-900"
                        />
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>

          <Card className="sticky bottom-20 md:bottom-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div>
                  <dt className="inline text-slate-500">Net income </dt>
                  <dd className="inline font-semibold tabular-nums">
                    {formatMoney(income, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Spent </dt>
                  <dd className="inline font-semibold tabular-nums">
                    {formatMoney(byBucket('essentials') + byBucket('fun'), currency)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Future You </dt>
                  <dd className="inline font-semibold tabular-nums">
                    {formatMoney(byBucket('future'), currency)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-slate-500">Unused </dt>
                  <dd
                    className={
                      unused < 0
                        ? 'inline font-semibold text-rose-600 tabular-nums'
                        : 'inline font-semibold tabular-nums'
                    }
                  >
                    {formatMoney(unused, currency)}
                  </dd>
                </div>
              </dl>
              <div className="flex items-center gap-3">
                {invalid.length > 0 && (
                  <span role="alert" className="text-sm text-rose-600">
                    Check {invalid.length} amount{invalid.length > 1 ? 's' : ''}
                  </span>
                )}
                {save.isSuccess && !dirty && (
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
                    <Check size={16} aria-hidden /> Saved
                  </span>
                )}
                <Button type="submit" disabled={!dirty || invalid.length > 0 || save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save month'}
                </Button>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Preview of this account’s totals only; the Budget page combines all accounts.
            </p>
            <div className="mt-2">
              <FormError error={save.error} />
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}

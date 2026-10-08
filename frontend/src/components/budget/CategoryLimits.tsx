import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Progress } from '../ui/Progress';
import { api } from '../../lib/api';
import { groupCategories, type GroupedCategory } from '../../lib/categoryGroups';
import { formatMoney, parseMoneyInput } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { BUCKETS, type Bucket, type CategorySummary, type MonthSummary } from '../../lib/types';

const asInput = (cents: number | null) =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
const BUCKET_COLOR: Record<Bucket, string> = {
  essentials: 'var(--c-essentials)',
  fun: 'var(--c-fun)',
  future: 'var(--c-future)',
};

type Save = ((limit: { categoryId: string; amount: number | null }) => void) | null;

export function CategoryLimits({ s, actions }: { s: MonthSummary; actions?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (limit: { categoryId: string; amount: number | null }) =>
      api.put<MonthSummary>(`/budget/${s.month}/limits`, { limits: [limit] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budget', s.month] }),
  });
  const groups = groupCategories(s.categories);
  const uncategorised = s.categories.find((c) => c.categoryId === null && c.actual > 0);

  return (
    <Card title="Categories" actions={actions}>
      <p className="mb-4 text-sm text-slate-500">
        Where the money went this month.{' '}
        {s.limitsEditable
          ? 'Set an optional monthly limit on any category.'
          : `Limits are shown converted to ${s.currency}; switch to your spending currency to change them.`}
      </p>
      <FormError error={save.error} />
      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map((g) => (
          <section
            key={g.bucket}
            aria-label={BUCKETS[g.bucket]}
            className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
          >
            <header className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ background: BUCKET_COLOR[g.bucket] }}
                />
                {BUCKETS[g.bucket]}
              </h3>
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(g.total, s.currency)}
              </span>
            </header>
            {g.shown.length === 0 && (
              <p className="py-2 text-sm text-slate-500">Nothing spent here yet.</p>
            )}
            <ul className="space-y-3">
              {g.shown.map((c) => (
                <Row
                  key={c.categoryId}
                  c={c}
                  currency={s.currency}
                  color={BUCKET_COLOR[g.bucket]}
                  save={s.limitsEditable ? save.mutate : null}
                />
              ))}
            </ul>
            <Unused
              key={`${s.month}-${g.bucket}`}
              rows={g.hidden}
              currency={s.currency}
              save={s.limitsEditable ? save.mutate : null}
            />
          </section>
        ))}
      </div>
      {uncategorised && (
        <p className="mt-4 text-sm text-slate-500">
          Plus{' '}
          <span className="font-medium text-slate-700 tabular-nums dark:text-slate-200">
            {formatMoney(uncategorised.actual, s.currency)}
          </span>{' '}
          without a category.
        </p>
      )}
    </Card>
  );
}

function Row({
  c,
  currency,
  color,
  save,
}: {
  c: GroupedCategory;
  currency: string;
  color: string;
  save: Save;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate">{c.name}</span>
        <span className="font-medium tabular-nums">{formatMoney(c.actual, currency)}</span>
      </div>
      <div className="mt-1.5">
        {c.limit !== null ? (
          <Progress
            label={`${c.name} used of limit`}
            value={(c.usedBp ?? 0) / 10_000}
            tone={c.over ? 'bad' : (c.usedBp ?? 0) > 8000 ? 'warn' : 'ok'}
          />
        ) : (
          <div aria-hidden className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${c.shareBp / 100}%`, background: color }}
            />
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        {c.limit !== null ? (
          <span
            className={clsx(
              'tabular-nums',
              c.over ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500',
            )}
          >
            {c.over
              ? `${formatMoney(-c.remaining!, currency)} over`
              : `${formatMoney(c.remaining!, currency)} left`}
          </span>
        ) : (
          <span className="text-slate-500 tabular-nums">{formatPercent(c.shareBp)} of bucket</span>
        )}
        <LimitEditor c={c} currency={currency} save={save} />
      </div>
    </li>
  );
}

/** Shows the limit (or "Set limit"); a click turns it into an input that saves on Enter/blur. */
function LimitEditor({ c, currency, save }: { c: CategorySummary; currency: string; save: Save }) {
  const [editing, setEditing] = useState(false);
  if (!c.categoryId) return null;
  if (!save) {
    return c.limit === null ? null : (
      <span className="px-1 text-slate-500 tabular-nums">
        Limit {formatMoney(c.limit, currency)}
      </span>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`${c.limit === null ? 'Set' : 'Change'} limit for ${c.name}`}
        onClick={() => setEditing(true)}
        className="rounded px-1 text-slate-500 tabular-nums hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
      >
        {c.limit === null ? 'Set limit' : `Limit ${formatMoney(c.limit, currency)}`}
      </button>
    );
  }
  return (
    <input
      aria-label={`Limit for ${c.name}`}
      inputMode="decimal"
      placeholder="No limit"
      autoFocus
      defaultValue={asInput(c.limit)}
      className="w-24 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-right text-xs tabular-nums placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900"
      onBlur={(e) => {
        setEditing(false);
        const text = e.target.value.trim();
        const amount = text === '' ? null : parseMoneyInput(text);
        if (text !== '' && (amount === null || amount <= 0)) return;
        if (amount !== c.limit) save({ categoryId: c.categoryId!, amount });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          e.currentTarget.value = asInput(c.limit);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Unused({
  rows,
  currency,
  save,
}: {
  rows: CategorySummary[];
  currency: string;
  save: Save;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {rows.length} more with no spending
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {rows.map((c) => (
            <li
              key={c.categoryId}
              className="flex items-center justify-between gap-2 text-sm text-slate-500"
            >
              <span className="truncate">{c.name}</span>
              <span className="text-xs">
                <LimitEditor c={c} currency={currency} save={save} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

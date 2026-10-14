import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Download, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import { TransactionForm } from '../components/transactions/TransactionForm';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { useAccounts, useCategories, useMembers } from '../lib/queries';
import { useBucketNames } from '../lib/buckets';
import { type Page, type Transaction } from '../lib/types';
import { isMonth, localMonth, monthEnd } from '../lib/months';
import { MonthNav } from '../components/ui/MonthNav';
import { useViewCurrency } from '../lib/viewCurrency';
import { useMe } from '../auth/auth';

const PAGE_SIZE = 100;
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

export function TransactionsPage() {
  const names = useBucketNames();
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get('month')) ? params.get('month')! : localMonth();
  const filter = (k: string) => params.get(k) ?? '';
  const page = Number(params.get('page') ?? 1);
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const me = useMe();
  const [view] = useViewCurrency();
  const accounts = useAccounts();
  const categories = useCategories();
  const members = useMembers();

  const query = new URLSearchParams({
    from: `${month}-01`,
    to: monthEnd(month),
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  for (const k of ['type', 'accountId', 'categoryId', 'memberId', 'q'])
    if (filter(k)) query.set(k, filter(k));
  // Totals are also given in one currency: the chosen one, else the spending currency.
  const totalIn = view === 'default' ? me.data?.family.spendingCurrency : view;
  if (totalIn) query.set('currency', totalIn);
  // The export holds exactly what the filters show (all pages).
  const exportQuery = new URLSearchParams(query);
  for (const k of ['page', 'pageSize', 'currency']) exportQuery.delete(k);
  const txns = useQuery({
    queryKey: ['transactions', query.toString()],
    queryFn: () => api.get<Page<Transaction>>(`/transactions?${query}`),
  });

  const pages = Math.max(1, Math.ceil((txns.data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} onChange={(m) => update({ month: m })} />
        <div className="flex gap-2">
          <a
            href={`/api/export/transactions.csv?${exportQuery}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download size={16} aria-hidden /> Export CSV
          </a>
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden /> Add transaction
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {txns.data?.converted &&
          (txns.data.totals.length > 1 ||
            txns.data.totals[0]?.currency !== txns.data.converted.currency) && (
            <ConvertedTotals c={txns.data.converted} />
          )}
        {txns.data?.totals.map(({ currency, ...t }) => (
          <Card key={currency} className="!p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {currency}
            </p>
            <div className="mt-1 flex justify-between text-sm">
              <span>Income</span>
              <span className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatMoney(t.income, currency)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Expenses</span>
              <span className="font-medium tabular-nums">{formatMoney(t.expense, currency)}</span>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 basis-full sm:basis-64">
          <Search
            size={16}
            className="pointer-events-none absolute top-2.5 left-3 text-slate-400"
            aria-hidden
          />
          <Input
            aria-label="Search"
            placeholder="Search merchant, notes, tags, category"
            className="pl-9"
            defaultValue={filter('q')}
            onKeyDown={(e) => e.key === 'Enter' && update({ q: e.currentTarget.value })}
            onBlur={(e) => e.target.value !== filter('q') && update({ q: e.target.value })}
          />
        </div>
        <Select
          aria-label="Type"
          className="!w-auto min-w-36 flex-1 sm:flex-none"
          value={filter('type')}
          onChange={(e) => update({ type: e.target.value })}
        >
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </Select>
        <Select
          aria-label="Account"
          className="!w-auto min-w-36 flex-1 sm:flex-none"
          value={filter('accountId')}
          onChange={(e) => update({ accountId: e.target.value })}
        >
          <option value="">All accounts</option>
          <option value="none">No account</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Category"
          className="!w-auto min-w-36 flex-1 sm:flex-none"
          value={filter('categoryId')}
          onChange={(e) => update({ categoryId: e.target.value })}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Member"
          className="!w-auto min-w-36 flex-1 sm:flex-none"
          value={filter('memberId')}
          onChange={(e) => update({ memberId: e.target.value })}
        >
          <option value="">Everyone</option>
          <option value="shared">Shared</option>
          {members.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>

      <FormError error={txns.error} />
      <Card className="!p-0">
        {txns.isPending ? (
          <p className="p-5 text-sm text-slate-500">Loading…</p>
        ) : txns.data?.items.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No transactions for this month and filter.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {txns.data?.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="grid w-full grid-cols-[3.5rem_1fr_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span className="text-xs text-slate-500 tabular-nums">{dayLabel(t.date)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {t.type === 'transfer'
                        ? `${t.accountName} → ${t.transferAccountName}`
                        : t.merchant || t.categoryName || 'Uncategorised'}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {t.type !== 'transfer' && (t.categoryName ?? 'Uncategorised')}
                      {t.bucket && ` · ${names[t.bucket]}`}
                      {t.type !== 'transfer' && ` · ${t.accountName ?? 'No account'}`}
                      {` · ${t.memberName ?? 'Shared'}`}
                      {t.notes && !t.isMonthlyTotal && ` · ${t.notes}`}
                      {t.isMonthlyTotal && ' · monthly total'}
                    </span>
                  </span>
                  <span
                    className={clsx(
                      'text-sm font-semibold tabular-nums',
                      t.type === 'income' && 'text-emerald-600 dark:text-emerald-400',
                      t.type === 'transfer' && 'text-slate-500',
                    )}
                  >
                    {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}
                    {formatMoney(t.amount, t.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= pages}
            onClick={() => update({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      )}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add transaction' : 'Edit transaction'}
          onClose={() => setEditing(null)}
        >
          <TransactionForm
            txn={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function ConvertedTotals({ c }: { c: NonNullable<Page<Transaction>['converted']> }) {
  return (
    <Card className="!p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        All in {c.currency}
      </p>
      <div className="mt-1 flex justify-between text-sm">
        <span>Income</span>
        <span className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
          {formatMoney(c.income, c.currency)}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Expenses</span>
        <span className="font-medium tabular-nums">{formatMoney(c.expense, c.currency)}</span>
      </div>
      {c.unconverted.length > 0 && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Without a rate: {c.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
    </Card>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Repeat } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field, FormError } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { api } from '../lib/api';
import { formatMoney, parseAmountInput } from '../lib/money';
import { localDay } from '../lib/months';
import { useAccounts, useCategories, useMembers } from '../lib/queries';
import { BUCKETS } from '../lib/types';

type Rule = {
  id: string;
  name: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  memberId: string | null;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string | null;
  active: boolean;
  nextDate: string | null;
};
type Upcoming = {
  ruleId: string;
  name: string;
  date: string;
  type: string;
  amount: number;
  currency: string;
};
const FREQ = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
} as const;

export function RecurringPage() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['recurring'], queryFn: () => api.get<Rule[]>('/recurring') });
  const upcoming = useQuery({
    queryKey: ['recurring', 'upcoming'],
    queryFn: () => api.get<Upcoming[]>('/recurring/upcoming?days=31'),
  });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (r: Rule) => api.put(`/recurring/${r.id}`, { active: !r.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring'] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recurring</h1>
          <p className="text-sm text-slate-500">
            Salary, rent, insurance, RD… created automatically on their day.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden /> Add recurring
        </Button>
      </div>
      <FormError error={rules.error ?? toggle.error} />
      <Card title="Rules">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rules.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  <Repeat size={16} className="shrink-0 text-slate-400" aria-hidden />
                  {r.name}
                  {!r.active && (
                    <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500 dark:bg-slate-800">
                      paused
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">
                  {FREQ[r.frequency]} · {r.accountName}
                  {r.categoryName && ` · ${r.categoryName}`}
                  {r.nextDate ? ` · next ${r.nextDate}` : r.active ? ' · ended' : ''}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={
                    r.type === 'income'
                      ? 'font-semibold text-emerald-600 tabular-nums dark:text-emerald-400'
                      : 'font-semibold tabular-nums'
                  }
                >
                  {r.type === 'income' ? '+' : '−'}
                  {formatMoney(r.amount, r.currency)}
                </span>
                <Button variant="secondary" className="!py-1" onClick={() => toggle.mutate(r)}>
                  {r.active ? 'Pause' : 'Resume'}
                </Button>
                <Button variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                  <Pencil size={16} aria-hidden />
                </Button>
              </span>
            </li>
          ))}
          {rules.data?.length === 0 && (
            <li className="py-2 text-sm text-slate-500">
              Nothing recurring yet. Add your salary or rent to start.
            </li>
          )}
        </ul>
      </Card>
      <Card title="Coming up in the next month">
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {upcoming.data?.map((u) => (
            <li key={`${u.ruleId}-${u.date}`} className="flex justify-between py-2">
              <span>
                <span className="mr-3 text-slate-500 tabular-nums">{u.date}</span>
                {u.name}
              </span>
              <span className="tabular-nums">
                {u.type === 'income' ? '+' : '−'}
                {formatMoney(u.amount, u.currency)}
              </span>
            </li>
          ))}
          {upcoming.data?.length === 0 && (
            <li className="py-2 text-slate-500">Nothing due in the next month.</li>
          )}
        </ul>
      </Card>
      {editing && (
        <Modal
          title={editing === 'new' ? 'Add recurring transaction' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <RuleForm
            rule={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function RuleForm({ rule, onDone }: { rule?: Rule; onDone: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const members = useMembers();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const [f, setF] = useState({
    name: rule?.name ?? '',
    type: rule?.type ?? 'expense',
    amount: rule ? String(rule.amount / 100).replace('.', ',') : '',
    accountId: rule?.accountId ?? active[0]?.id ?? '',
    categoryId: rule?.categoryId ?? '',
    memberId: rule?.memberId ?? '',
    frequency: rule?.frequency ?? 'monthly',
    startDate: rule?.startDate ?? localDay(),
    endDate: rule?.endDate ?? '',
    backfill: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const done = async () => {
    await Promise.all(
      ['recurring', 'transactions', 'accounts', 'budget', 'dashboard'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      rule ? api.put(`/recurring/${rule.id}`, body) : api.post('/recurring', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/recurring/${rule!.id}`),
    onSuccess: done,
  });
  const cats = (categories.data ?? []).filter((c) => c.kind === f.type);
  const pastStart = f.startDate < localDay();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const amount = parseAmountInput(f.amount);
        if (amount === null || amount <= 0) return setErr('Enter an amount, e.g. 912,00');
        setErr(null);
        const common = {
          name: f.name,
          amount,
          categoryId: f.categoryId || null,
          memberId: f.memberId || null,
          endDate: f.endDate || null,
        };
        save.mutate(
          rule
            ? common
            : {
                ...common,
                type: f.type,
                accountId: f.accountId,
                frequency: f.frequency,
                startDate: f.startDate,
                backfill: f.backfill,
              },
        );
      }}
    >
      <Field label="Name" htmlFor="rec-name">
        <Input
          id="rec-name"
          required
          placeholder="e.g. Rent"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="rec-type">
          <Select
            id="rec-type"
            disabled={!!rule}
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value as Rule['type'], categoryId: '' })}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </Select>
        </Field>
        <Field label="Amount" htmlFor="rec-amount">
          <Input
            id="rec-amount"
            required
            inputMode="decimal"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </Field>
        <Field label="Account" htmlFor="rec-account">
          <Select
            id="rec-account"
            disabled={!!rule}
            value={f.accountId}
            onChange={(e) => setF({ ...f, accountId: e.target.value })}
          >
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category" htmlFor="rec-category">
          <Select
            id="rec-category"
            value={f.categoryId}
            onChange={(e) => setF({ ...f, categoryId: e.target.value })}
          >
            <option value="">Uncategorised</option>
            {f.type === 'expense'
              ? (Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((b) => (
                  <optgroup key={b} label={BUCKETS[b]}>
                    {cats
                      .filter((c) => c.bucket === b)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                ))
              : cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
          </Select>
        </Field>
        <Field label="How often" htmlFor="rec-frequency">
          <Select
            id="rec-frequency"
            disabled={!!rule}
            value={f.frequency}
            onChange={(e) => setF({ ...f, frequency: e.target.value as Rule['frequency'] })}
          >
            {Object.entries(FREQ).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Family member" htmlFor="rec-member">
          <Select
            id="rec-member"
            value={f.memberId}
            onChange={(e) => setF({ ...f, memberId: e.target.value })}
          >
            <option value="">Shared</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="First date"
          htmlFor="rec-start"
          hint="The day of the month repeats; the 31st becomes the last day in shorter months."
        >
          <Input
            id="rec-start"
            type="date"
            disabled={!!rule}
            required
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
          />
        </Field>
        <Field label="Ends (optional)" htmlFor="rec-end">
          <Input
            id="rec-end"
            type="date"
            value={f.endDate}
            onChange={(e) => setF({ ...f, endDate: e.target.value })}
          />
        </Field>
      </div>
      {!rule && pastStart && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={f.backfill}
            onChange={(e) => setF({ ...f, backfill: e.target.checked })}
          />
          <span>
            Also create the past ones since {f.startDate}
            <span className="block text-xs text-slate-500">
              Leave this off if those months are already in the app (e.g. imported from your
              spreadsheet).
            </span>
          </span>
        </label>
      )}
      {err && (
        <p role="alert" className="text-sm text-rose-600">
          {err}
        </p>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between">
        {rule ? (
          <Button
            variant="ghost"
            className="text-rose-600"
            onClick={() =>
              window.confirm(`Delete ${rule.name}? Transactions already created stay.`) &&
              remove.mutate()
            }
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

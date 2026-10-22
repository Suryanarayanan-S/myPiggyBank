import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import type { Goal } from '../../lib/goals';
import { formatMoney, parseAmountInput } from '../../lib/money';
import { localDay } from '../../lib/months';
import { useAccounts, useMembers } from '../../lib/queries';
import { CURRENCIES } from '../../lib/types';
import type { HoldingsResponse } from '../../lib/investments';
import { useDeposits } from '../../lib/deposits';
import type { Asset } from '../../lib/wealthTypes';

const asInput = (cents: number) => String(cents / 100).replace('.', ',');

/** Create or edit a goal: target, optional date and owner, and what counts towards it. */
export function GoalForm({
  goal,
  defaultCurrency,
  onDone,
}: {
  goal?: Goal;
  defaultCurrency: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const members = useMembers();
  const assets = useQuery({ queryKey: ['assets'], queryFn: () => api.get<Asset[]>('/assets') });
  const deposits = useDeposits();
  const holdings = useQuery({
    queryKey: ['holdings', 'default'],
    queryFn: () => api.get<HoldingsResponse>('/holdings'),
  });
  const [f, setF] = useState({
    name: goal?.name ?? '',
    target: goal ? asInput(goal.targetAmount) : '',
    currency: goal?.currency ?? defaultCurrency,
    targetDate: goal?.targetDate ?? '',
    memberId: goal?.memberId ?? '',
    note: goal?.note ?? '',
    status: goal?.status ?? 'active',
    links: new Set((goal?.links ?? []).map((l) => `${l.kind}:${l.id}`)),
  });
  const [err, setErr] = useState<string | null>(null);
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['goals'] });
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      goal ? api.put(`/goals/${goal.id}`, body) : api.post('/goals', body),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.del(`/goals/${goal!.id}`), onSuccess: done });
  const toggle = (key: string) => {
    const links = new Set(f.links);
    if (links.has(key)) links.delete(key);
    else links.add(key);
    setF({ ...f, links });
  };
  const targetAmount = parseAmountInput(f.target);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (targetAmount === null || targetAmount <= 0) return setErr('Enter a target amount');
        setErr(null);
        save.mutate({
          name: f.name,
          targetAmount,
          currency: f.currency,
          targetDate: f.targetDate || null,
          memberId: f.memberId || null,
          note: f.note || null,
          ...(goal && { status: f.status }),
          links: [...f.links].map((k) => {
            const [kind, id] = k.split(':');
            return { kind, id };
          }),
        });
      }}
    >
      <Field label="Name" htmlFor="goal-name">
        <Input
          id="goal-name"
          required
          maxLength={60}
          placeholder="House deposit"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field
          label="Target"
          htmlFor="goal-target"
          hint={
            targetAmount
              ? `= ${formatMoney(targetAmount, f.currency)}`
              : 'e.g. 20000 or, in INR, 15 L'
          }
        >
          <Input
            id="goal-target"
            inputMode="decimal"
            required
            value={f.target}
            onChange={(e) => setF({ ...f, target: e.target.value })}
          />
        </Field>
        <Field label="Currency" htmlFor="goal-currency">
          <Select
            id="goal-currency"
            // entries are amounts in this currency, so it is fixed once there are some
            disabled={!!goal?.entries.length}
            value={f.currency}
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reach it by (optional)" htmlFor="goal-date">
          <Input
            id="goal-date"
            type="date"
            value={f.targetDate}
            onChange={(e) => setF({ ...f, targetDate: e.target.value })}
          />
        </Field>
        <Field label="For" htmlFor="goal-member">
          <Select
            id="goal-member"
            value={f.memberId}
            onChange={(e) => setF({ ...f, memberId: e.target.value })}
          >
            <option value="">Whole family</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
          What counts towards it
        </legend>
        <p className="text-xs text-slate-500">
          Ticked accounts count with their balance, assets and investments with their value. Money
          kept elsewhere can be added as entries on the goal.
        </p>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          {accounts.data
            // archived accounts only while linked, so they can still be unticked
            ?.filter((a) => !a.archived || f.links.has(`account:${a.id}`))
            .map((a) => (
              <label key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={f.links.has(`account:${a.id}`)}
                    onChange={() => toggle(`account:${a.id}`)}
                  />
                  {a.name}
                  {a.archived && <span className="text-xs text-slate-400">archived</span>}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {formatMoney(a.balance, a.currency)}
                </span>
              </label>
            ))}
          {assets.data?.map((a) => (
            <label key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={f.links.has(`asset:${a.id}`)}
                  onChange={() => toggle(`asset:${a.id}`)}
                />
                {a.name} <span className="text-xs text-slate-400">asset</span>
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {a.value === null ? '—' : formatMoney(a.value, a.currency)}
              </span>
            </label>
          ))}
          {holdings.data?.holdings
            .filter((h) => !h.archived || f.links.has(`holding:${h.id}`))
            .map((h) => (
              <label key={h.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={f.links.has(`holding:${h.id}`)}
                    onChange={() => toggle(`holding:${h.id}`)}
                  />
                  {h.name} <span className="text-xs text-slate-400">investment</span>
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {h.value === null ? '—' : formatMoney(h.value, h.currency)}
                </span>
              </label>
            ))}
          {deposits.data?.deposits
            .filter((d) => d.status !== 'closed' || f.links.has(`deposit:${d.id}`))
            .map((d) => (
              <label key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={f.links.has(`deposit:${d.id}`)}
                    onChange={() => toggle(`deposit:${d.id}`)}
                  />
                  {d.name} <span className="text-xs text-slate-400">fixed deposit</span>
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  {formatMoney(d.value ?? d.principal, d.currency)}
                </span>
              </label>
            ))}
          {accounts.data?.length === 0 &&
            assets.data?.length === 0 &&
            holdings.data?.holdings.length === 0 &&
            deposits.data?.deposits.length === 0 && (
              <p className="text-sm text-slate-500">No accounts, assets or investments yet.</p>
            )}
        </div>
      </fieldset>

      <Field label="Note (optional)" htmlFor="goal-note">
        <Input
          id="goal-note"
          maxLength={500}
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
        />
      </Field>
      {goal && (
        <Field label="Status" htmlFor="goal-status">
          <Select
            id="goal-status"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value as Goal['status'] })}
          >
            <option value="active">Active</option>
            <option value="reached">Reached</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between gap-2">
        {goal ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => window.confirm(`Delete the goal “${goal.name}”?`) && remove.mutate()}
          >
            <Trash2 size={16} aria-hidden /> Delete
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

/** Money for the goal kept elsewhere; a negative amount is money taken out. */
export function EntriesForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({ date: localDay(), amount: '', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['goals'] });
  const add = useMutation({
    mutationFn: (body: object) => api.post(`/goals/${goal.id}/entries`, body),
    onSuccess: async () => {
      setF({ ...f, amount: '', note: '' });
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/goals/${goal.id}/entries/${id}`),
    onSuccess: refresh,
  });
  const negative = /^[-−]/.test(f.amount.trim());
  const rest = f.amount.trim().replace(/^[-−]\s*/, '');
  const parsed = /^[-−+]/.test(rest) ? null : parseAmountInput(rest); // one sign only
  const amount = parsed === null ? null : negative ? -parsed : parsed;

  return (
    <div className="space-y-4">
      <form
        className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[9rem_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!amount) return setErr('Enter an amount (− for money taken out)');
          setErr(null);
          add.mutate({ date: f.date, amount, note: f.note || null });
        }}
      >
        <Field label="Date" htmlFor="entry-date">
          <Input
            id="entry-date"
            type="date"
            required
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
          />
        </Field>
        <Field label={`Amount (${goal.currency})`} htmlFor="entry-amount">
          <Input
            id="entry-amount"
            inputMode="decimal"
            placeholder="500 or −200"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
          />
        </Field>
        <Field label="Note" htmlFor="entry-note">
          <Input
            id="entry-note"
            maxLength={200}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <FormError error={add.error ?? remove.error} />
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {goal.entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="inline-block w-24 text-slate-500">{e.date}</span>
              {e.note}
            </span>
            <span className="flex items-center gap-1">
              <span className="font-medium tabular-nums">
                {formatMoney(e.amount, goal.currency)}
              </span>
              <Button
                variant="ghost"
                aria-label={`Delete entry from ${e.date}`}
                onClick={() =>
                  window.confirm(`Delete the entry from ${e.date}?`) && remove.mutate(e.id)
                }
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </span>
          </li>
        ))}
        {goal.entries.length === 0 && <li className="py-2 text-slate-500">No entries yet.</li>}
      </ul>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

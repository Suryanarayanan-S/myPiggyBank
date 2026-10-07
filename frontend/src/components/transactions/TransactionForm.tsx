import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { parseMoneyInput } from '../../lib/money';
import { useAccounts, useCategories, useMembers } from '../../lib/queries';
import { BUCKETS, type Transaction, type TransactionType } from '../../lib/types';

const today = () => new Date().toISOString().slice(0, 10);
const asInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2).replace('.', ',');

export function TransactionForm({ txn, onDone }: { txn?: Transaction; onDone: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const members = useMembers();
  const active = (accounts.data ?? []).filter((a) => !a.archived || a.id === txn?.accountId);

  const [type, setType] = useState<TransactionType>(txn?.type ?? 'expense');
  const [form, setForm] = useState({
    date: txn?.date ?? today(),
    amount: asInput(txn?.amount),
    accountId: txn?.accountId ?? active[0]?.id ?? '',
    categoryId: txn?.categoryId ?? '',
    memberId: txn?.memberId ?? '',
    merchant: txn?.merchant ?? '',
    notes: txn?.notes ?? '',
    tags: txn?.tags.join(', ') ?? '',
    transferAccountId: txn?.transferAccountId ?? '',
    transferAmount: asInput(txn?.transferAmount),
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const account = active.find((a) => a.id === form.accountId);
  const dest = active.find((a) => a.id === form.transferAccountId);
  const crossCurrency =
    type === 'transfer' && account && dest && account.currency !== dest.currency;

  const done = async () => {
    await Promise.all(
      ['transactions', 'accounts'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    );
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      txn ? api.put(`/transactions/${txn.id}`, body) : api.post('/transactions', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/transactions/${txn!.id}`),
    onSuccess: done,
  });

  const submit = () => {
    const amount = parseMoneyInput(form.amount);
    if (amount === null || amount <= 0)
      return setLocalError('Enter an amount above zero, e.g. 52,40');
    let transferAmount: number | null = null;
    if (crossCurrency) {
      transferAmount = parseMoneyInput(form.transferAmount);
      if (transferAmount === null || transferAmount <= 0)
        return setLocalError(`Enter the amount received in ${dest!.currency}`);
    }
    setLocalError(null);
    save.mutate({
      date: form.date,
      amount,
      type,
      accountId: form.accountId,
      categoryId: type === 'transfer' ? null : form.categoryId || null,
      memberId: form.memberId || null,
      merchant: form.merchant || null,
      notes: form.notes || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      ...(type === 'transfer' ? { transferAccountId: form.transferAccountId, transferAmount } : {}),
    });
  };

  const cats = (categories.data ?? []).filter((c) => c.kind === type);
  const groups =
    type === 'expense'
      ? (Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).map((b) => ({
          label: BUCKETS[b],
          items: cats.filter((c) => c.bucket === b),
        }))
      : [{ label: 'Income', items: cats }];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        role="tablist"
        className="grid grid-cols-3 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
      >
        {(['expense', 'income', 'transfer'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => {
              setType(t);
              set('categoryId')('');
            }}
            className={clsx(
              'rounded-md py-1.5 text-sm font-medium capitalize',
              type === t ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount${account ? ` (${account.currency})` : ''}`} htmlFor="txn-amount">
          <Input
            id="txn-amount"
            inputMode="decimal"
            required
            autoFocus
            placeholder="52,40"
            value={form.amount}
            onChange={(e) => set('amount')(e.target.value)}
          />
        </Field>
        <Field label="Date" htmlFor="txn-date">
          <Input
            id="txn-date"
            type="date"
            required
            value={form.date}
            onChange={(e) => set('date')(e.target.value)}
          />
        </Field>
      </div>

      <Field label={type === 'transfer' ? 'From account' : 'Account'} htmlFor="txn-account">
        <Select
          id="txn-account"
          required
          value={form.accountId}
          onChange={(e) => set('accountId')(e.target.value)}
        >
          {active.length === 0 && <option value="">Add an account first</option>}
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </Select>
      </Field>

      {type === 'transfer' ? (
        <>
          <Field label="To account" htmlFor="txn-dest">
            <Select
              id="txn-dest"
              required
              value={form.transferAccountId}
              onChange={(e) => set('transferAccountId')(e.target.value)}
            >
              <option value="">Choose…</option>
              {active
                .filter((a) => a.id !== form.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </Select>
          </Field>
          {crossCurrency && (
            <Field label={`Amount received (${dest!.currency})`} htmlFor="txn-received">
              <Input
                id="txn-received"
                inputMode="decimal"
                required
                value={form.transferAmount}
                onChange={(e) => set('transferAmount')(e.target.value)}
              />
            </Field>
          )}
        </>
      ) : (
        <Field label="Category" htmlFor="txn-category">
          <Select
            id="txn-category"
            value={form.categoryId}
            onChange={(e) => set('categoryId')(e.target.value)}
          >
            <option value="">Uncategorised</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={type === 'income' ? 'From (payer)' : 'Merchant'} htmlFor="txn-merchant">
          <Input
            id="txn-merchant"
            placeholder={type === 'income' ? 'Employer' : 'REWE'}
            value={form.merchant}
            onChange={(e) => set('merchant')(e.target.value)}
          />
        </Field>
        <Field label="Family member" htmlFor="txn-member">
          <Select
            id="txn-member"
            value={form.memberId}
            onChange={(e) => set('memberId')(e.target.value)}
          >
            <option value="">Shared</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor="txn-notes">
        <Input id="txn-notes" value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Field label="Tags" htmlFor="txn-tags" hint="Comma separated, e.g. holiday, baby">
        <Input id="txn-tags" value={form.tags} onChange={(e) => set('tags')(e.target.value)} />
      </Field>

      {localError && (
        <p role="alert" className="text-sm text-rose-600">
          {localError}
        </p>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex items-center justify-between gap-2 pt-2">
        {txn ? (
          <Button
            variant="ghost"
            className="text-rose-600"
            disabled={remove.isPending}
            onClick={() => window.confirm('Delete this transaction?') && remove.mutate()}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending || active.length === 0}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

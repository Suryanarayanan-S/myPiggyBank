import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { parseMoneyInput } from '../../lib/money';
import { useMembers } from '../../lib/queries';
import { ACCOUNT_TYPES, ASSET_CLASSES, CURRENCIES, type Account } from '../../lib/types';
import { TakesNote, useFirstDematTakes } from '../investments/DematPicker';

export function AccountForm({
  account,
  defaultCurrency,
  onDone,
}: {
  account?: Account;
  defaultCurrency: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'current',
    currency: account?.currency ?? defaultCurrency,
    opening: account ? String(account.openingBalance / 100) : '0',
    ownerMemberId: account?.ownerMemberId ?? '',
    assetClass: account?.assetClass ?? '',
    archived: account?.archived ?? false,
  });
  const takes = useFirstDematTakes(form.ownerMemberId || null);
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const done = async () => {
    await Promise.all(
      // a first demat takes the person's holdings
      ['accounts', 'goals', 'holdings'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    );
    onDone();
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      account ? api.put(`/accounts/${account.id}`, body) : api.post('/accounts', body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/accounts/${account!.id}`),
    onSuccess: done,
  });

  const submit = () => {
    const openingBalance = parseMoneyInput(form.opening);
    if (openingBalance === null) return setLocalError('Enter the opening balance, e.g. 1.234,56');
    setLocalError(null);
    save.mutate({
      name: form.name,
      type: form.type,
      currency: form.currency,
      openingBalance,
      ownerMemberId: form.ownerMemberId || null,
      ...(form.assetClass ? { assetClass: form.assetClass } : {}),
      ...(account ? { archived: form.archived } : {}),
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Name" htmlFor="acc-name">
        <Input
          id="acc-name"
          required
          placeholder="e.g. Sparkasse"
          value={form.name}
          onChange={(e) => set('name')(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="acc-type">
          <Select id="acc-type" value={form.type} onChange={(e) => set('type')(e.target.value)}>
            {Object.entries(ACCOUNT_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="acc-currency">
          <Select
            id="acc-currency"
            value={form.currency}
            onChange={(e) => set('currency')(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Opening balance"
        htmlFor="acc-opening"
        hint="Balance before the first transaction you record here."
      >
        <Input
          id="acc-opening"
          inputMode="decimal"
          value={form.opening}
          onChange={(e) => set('opening')(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Owner" htmlFor="acc-owner">
          <Select
            id="acc-owner"
            value={form.ownerMemberId}
            onChange={(e) => set('ownerMemberId')(e.target.value)}
          >
            <option value="">Shared</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Counts as" htmlFor="acc-class">
          <Select
            id="acc-class"
            value={form.assetClass}
            onChange={(e) => set('assetClass')(e.target.value)}
          >
            {!account && <option value="">Automatic</option>}
            {Object.entries(ASSET_CLASSES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {account && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.archived}
            onChange={(e) => set('archived')(e.target.checked)}
          />
          Archived (hidden from pickers, kept in history)
        </label>
      )}
      {localError && (
        <p role="alert" className="text-sm text-rose-600">
          {localError}
        </p>
      )}
      {!account && form.type === 'investment' && form.currency === 'INR' && (
        <TakesNote
          count={takes}
          owner={members.data?.find((m) => m.id === form.ownerMemberId)?.name ?? null}
        />
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex items-center justify-between gap-2 pt-2">
        {account ? (
          <Button
            variant="ghost"
            className="text-rose-600"
            disabled={remove.isPending}
            onClick={() => window.confirm(`Delete ${account.name}?`) && remove.mutate()}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

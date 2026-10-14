import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { formatMoney, parseAmountInput } from '../../lib/money';
import { localDay } from '../../lib/months';
import { useMembers } from '../../lib/queries';
import { CURRENCIES } from '../../lib/types';
import { CLASSES, LIABILITY_TYPES, type Asset, type Liability } from '../../lib/wealthTypes';

const refreshKeys = ['assets', 'liabilities', 'net-worth', 'goals'];
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(refreshKeys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
}
const asInput = (cents: number | null | undefined) => (cents == null ? '' : String(cents / 100));

export function AmountField({
  id,
  label,
  value,
  onChange,
  currency,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  hint?: string;
}) {
  const parsed = value.trim() ? parseAmountInput(value) : null;
  return (
    <Field
      label={label}
      htmlFor={id}
      // Always show what was understood, so "135" can never be mistaken for "135 L".
      hint={
        parsed !== null
          ? `= ${formatMoney(parsed, currency)}`
          : value.trim()
            ? 'Not a valid amount'
            : (hint ?? 'e.g. 80 L, 1.2 Cr or 25,00,000')
      }
    >
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function OwnerSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const members = useMembers();
  return (
    <Field label="Belongs to" htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Shared (family)</option>
        {members.data?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function AssetForm({
  asset,
  currency,
  onDone,
}: {
  asset?: Asset;
  currency: string;
  onDone: () => void;
}) {
  const refresh = useRefresh();
  const [f, setF] = useState({
    name: asset?.name ?? '',
    assetClass: asset?.assetClass ?? 'property',
    currency: asset?.currency ?? currency,
    owner: asset?.ownerMemberId ?? '',
    notes: asset?.notes ?? '',
    value: '',
    date: localDay(),
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      asset ? api.put(`/assets/${asset.id}`, body) : api.post('/assets', body),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/assets/${asset!.id}`),
    onSuccess: async () => (await refresh(), onDone()),
  });
  const submit = () => {
    const value = f.value.trim() ? parseAmountInput(f.value) : undefined;
    if (value === null) return setErr('Enter the value, e.g. 80 L or 1.2 Cr');
    setErr(null);
    save.mutate({
      name: f.name,
      assetClass: f.assetClass,
      currency: f.currency,
      ownerMemberId: f.owner || null,
      notes: f.notes || null,
      ...(!asset && value !== undefined && { value, date: f.date }),
    });
  };
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), submit())}>
      <Field label="Name" htmlFor="asset-name">
        <Input
          id="asset-name"
          required
          placeholder="e.g. Jothi ilam"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="asset-class">
          <Select
            id="asset-class"
            value={f.assetClass}
            onChange={(e) => setF({ ...f, assetClass: e.target.value as Asset['assetClass'] })}
          >
            {Object.entries(CLASSES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="asset-currency">
          <Select
            id="asset-currency"
            value={f.currency}
            disabled={!!asset?.history.length}
            title={
              asset?.history.length
                ? 'Locked: values are already recorded in this currency'
                : undefined
            }
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <OwnerSelect id="asset-owner" value={f.owner} onChange={(owner) => setF({ ...f, owner })} />
      {!asset && (
        <div className="grid grid-cols-2 gap-3">
          <AmountField
            id="asset-value"
            label="Current value"
            value={f.value}
            onChange={(value) => setF({ ...f, value })}
            currency={f.currency}
          />
          <Field label="Valued on" htmlFor="asset-date">
            <Input
              id="asset-date"
              type="date"
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
        </div>
      )}
      <Field label="Notes" htmlFor="asset-notes">
        <Input
          id="asset-notes"
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-rose-600">
          {err}
        </p>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between">
        {asset ? (
          <Button
            variant="ghost"
            className="text-rose-600"
            onClick={() =>
              window.confirm(`Delete ${asset.name} and its value history?`) && remove.mutate()
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

export function LiabilityForm({
  liability,
  currency,
  onDone,
}: {
  liability?: Liability;
  currency: string;
  onDone: () => void;
}) {
  const refresh = useRefresh();
  const [f, setF] = useState({
    name: liability?.name ?? '',
    type: liability?.type ?? 'car_loan',
    currency: liability?.currency ?? currency,
    owner: liability?.ownerMemberId ?? '',
    original: asInput(liability?.originalAmount),
    rate: liability?.interestRate ?? '',
    monthly: asInput(liability?.monthlyPayment),
    start: liability?.startDate ?? '',
    end: liability?.endDate ?? '',
    lender: liability?.lender ?? '',
    notes: liability?.notes ?? '',
    outstanding: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) =>
      liability ? api.put(`/liabilities/${liability.id}`, body) : api.post('/liabilities', body),
    onSuccess: async () => (await refresh(), onDone()),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/liabilities/${liability!.id}`),
    onSuccess: async () => (await refresh(), onDone()),
  });
  const opt = (s: string) => (s.trim() ? parseAmountInput(s) : undefined);
  const submit = () => {
    const original = opt(f.original);
    const monthly = opt(f.monthly);
    const outstanding = opt(f.outstanding);
    if (original === null || monthly === null || outstanding === null)
      return setErr('Check the amounts, e.g. 15.000 or 12 L');
    setErr(null);
    save.mutate({
      name: f.name,
      type: f.type,
      currency: f.currency,
      ownerMemberId: f.owner || null,
      originalAmount: original ?? null,
      interestRate: f.rate.trim() || null,
      monthlyPayment: monthly ?? null,
      startDate: f.start || null,
      endDate: f.end || null,
      lender: f.lender || null,
      notes: f.notes || null,
      ...(!liability && outstanding !== undefined && { outstanding, date: localDay() }),
    });
  };
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), submit())}>
      <Field label="Name" htmlFor="li-name">
        <Input
          id="li-name"
          required
          placeholder="e.g. Car loan"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="li-type">
          <Select
            id="li-type"
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value as Liability['type'] })}
          >
            {Object.entries(LIABILITY_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor="li-currency">
          <Select
            id="li-currency"
            value={f.currency}
            disabled={!!liability?.history.length}
            title={
              liability?.history.length
                ? 'Locked: values are already recorded in this currency'
                : undefined
            }
            onChange={(e) => setF({ ...f, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <OwnerSelect id="li-owner" value={f.owner} onChange={(owner) => setF({ ...f, owner })} />
      {!liability && (
        <AmountField
          id="li-outstanding"
          label="Outstanding today"
          value={f.outstanding}
          onChange={(outstanding) => setF({ ...f, outstanding })}
          currency={f.currency}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <AmountField
          id="li-original"
          label="Original amount"
          value={f.original}
          onChange={(original) => setF({ ...f, original })}
          currency={f.currency}
          hint="optional"
        />
        <Field label="Interest % per year" htmlFor="li-rate" hint="optional">
          <Input
            id="li-rate"
            inputMode="decimal"
            placeholder="3.75"
            value={f.rate}
            onChange={(e) => setF({ ...f, rate: e.target.value })}
          />
        </Field>
        <AmountField
          id="li-monthly"
          label="Monthly payment"
          value={f.monthly}
          onChange={(monthly) => setF({ ...f, monthly })}
          currency={f.currency}
          hint="optional"
        />
        <Field label="Lender" htmlFor="li-lender" hint="optional">
          <Input
            id="li-lender"
            value={f.lender}
            onChange={(e) => setF({ ...f, lender: e.target.value })}
          />
        </Field>
        <Field label="Start date" htmlFor="li-start">
          <Input
            id="li-start"
            type="date"
            value={f.start}
            onChange={(e) => setF({ ...f, start: e.target.value })}
          />
        </Field>
        <Field label="End date" htmlFor="li-end">
          <Input
            id="li-end"
            type="date"
            value={f.end}
            onChange={(e) => setF({ ...f, end: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor="li-notes">
        <Input
          id="li-notes"
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-rose-600">
          {err}
        </p>
      )}
      <FormError error={save.error ?? remove.error} />
      <div className="flex justify-between">
        {liability ? (
          <Button
            variant="ghost"
            className="text-rose-600"
            onClick={() => window.confirm(`Delete ${liability.name}?`) && remove.mutate()}
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

/** Value history of an asset or balance history of a liability, with "add new value". */
export function HistoryForm({
  kind,
  item,
  onDone,
}: {
  kind: 'asset' | 'liability';
  item: Asset | Liability;
  onDone: () => void;
}) {
  const refresh = useRefresh();
  const [value, setValue] = useState('');
  const [date, setDate] = useState(localDay());
  const [err, setErr] = useState<string | null>(null);
  const base =
    kind === 'asset' ? `/assets/${item.id}/valuations` : `/liabilities/${item.id}/balances`;
  const add = useMutation({
    mutationFn: (amount: number) =>
      api.post(base, kind === 'asset' ? { date, value: amount } : { date, outstanding: amount }),
    onSuccess: async () => (setValue(''), await refresh()),
  });
  const remove = useMutation({
    mutationFn: (hid: string) => api.del(`${base}/${hid}`),
    onSuccess: refresh,
  });
  const rows =
    'value' in item
      ? (item as Asset).history.map((h) => ({ id: h.id, date: h.date, amount: h.value }))
      : (item as Liability).history.map((h) => ({ id: h.id, date: h.date, amount: h.outstanding }));
  return (
    <div className="space-y-4">
      <form
        className="grid grid-cols-[1fr_auto] items-end gap-3 sm:grid-cols-[1fr_10rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = parseAmountInput(value);
          if (amount === null) return setErr('Enter an amount, e.g. 85 L');
          setErr(null);
          add.mutate(amount);
        }}
      >
        <AmountField
          id="hist-value"
          label={kind === 'asset' ? 'New value' : 'Outstanding now'}
          value={value}
          onChange={setValue}
          currency={item.currency}
        />
        <Field label="On" htmlFor="hist-date">
          <Input
            id="hist-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {err && (
        <p role="alert" className="text-sm text-rose-600">
          {err}
        </p>
      )}
      <FormError error={add.error ?? remove.error} />
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between py-2">
            <span className="text-slate-500">
              {r.date}
              {i === 0 && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">
                  current
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-medium tabular-nums">
                {formatMoney(r.amount, item.currency)}
              </span>
              <button
                type="button"
                aria-label={`Delete entry from ${r.date}`}
                className="p-1 text-slate-400 hover:text-rose-600"
                onClick={() =>
                  window.confirm(`Delete the entry from ${r.date}?`) && remove.mutate(r.id)
                }
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-slate-500">No values yet.</li>}
      </ul>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

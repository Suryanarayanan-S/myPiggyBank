import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { useRates } from '../../lib/queries';
import { CURRENCIES, type Family } from '../../lib/types';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function RatesCard({ family }: { family: Family }) {
  const rates = useRates();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    month: new Date().toISOString().slice(0, 7),
    base: family.spendingCurrency,
    quote: family.wealthCurrency === family.spendingCurrency ? 'INR' : family.wealthCurrency,
    rate: '',
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rates'] });
  const save = useMutation({
    mutationFn: () => api.put('/exchange-rates', form),
    onSuccess: async () => {
      setForm((f) => ({ ...f, rate: '' }));
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/exchange-rates/${id}`),
    onSuccess: refresh,
  });

  return (
    <Card title="Exchange rates">
      <p className="mb-4 text-sm text-slate-500">
        One rate per month, used to convert between currencies (e.g. India spending into your EUR
        month). If a month has no rate, the latest earlier month is used.
      </p>
      <form
        className="grid grid-cols-2 items-end gap-3 sm:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Month" htmlFor="rate-month">
          <Input
            id="rate-month"
            type="month"
            required
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
          />
        </Field>
        <Field label="1 ×" htmlFor="rate-base">
          <Select
            id="rate-base"
            value={form.base}
            onChange={(e) => setForm({ ...form, base: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="equals" htmlFor="rate-value">
          <Input
            id="rate-value"
            inputMode="decimal"
            required
            placeholder="97.85"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
          />
        </Field>
        <Field label="in" htmlFor="rate-quote">
          <Select
            id="rate-quote"
            value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={save.isPending}>
          Save rate
        </Button>
      </form>
      <div className="mt-2">
        <FormError error={save.error ?? remove.error} />
      </div>
      <ul className="mt-4 divide-y divide-slate-200 text-sm dark:divide-slate-800">
        {rates.data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2">
            <span>
              <span className="inline-block w-20 text-slate-500">{monthLabel(r.month)}</span>1{' '}
              {r.base} = <span className="font-medium tabular-nums">{r.rate}</span> {r.quote}
            </span>
            <Button
              variant="ghost"
              aria-label={`Delete rate for ${monthLabel(r.month)}`}
              onClick={() => remove.mutate(r.id)}
            >
              <Trash2 size={14} aria-hidden />
            </Button>
          </li>
        ))}
        {rates.data?.length === 0 && <li className="py-2 text-slate-500">No rates yet.</li>}
      </ul>
    </Card>
  );
}

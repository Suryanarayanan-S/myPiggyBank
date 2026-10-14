import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { useRates } from '../../lib/queries';
import { localMonth } from '../../lib/months';
import { CURRENCIES, type Family } from '../../lib/types';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

type LiveStatus = { asOf: string | null; fetchedAt: string | null; lastError: string | null };

export function RatesCard({ family }: { family: Family }) {
  const rates = useRates();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    month: localMonth(),
    base: family.spendingCurrency,
    quote: family.wealthCurrency === family.spendingCurrency ? 'INR' : family.wealthCurrency,
    rate: '',
  });
  // Rates change every converted figure, so refresh everything (not just this list).
  const refresh = () => queryClient.invalidateQueries();
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

  const live = family.rateMode === 'live';
  const status = useQuery({
    queryKey: ['rates', 'live'],
    queryFn: () => api.get<LiveStatus>('/exchange-rates/live'),
    enabled: live,
  });
  const download = useMutation({
    mutationFn: () => api.post<LiveStatus>('/exchange-rates/live/refresh'),
    onSuccess: refresh,
  });
  const mode = useMutation({
    mutationFn: (rateMode: 'manual' | 'live') => api.put('/family', { rateMode }),
    onSuccess: async (_d, rateMode) => {
      await refresh();
      if (rateMode === 'live') download.mutate();
    },
  });

  return (
    <Card title="Exchange rates">
      <div
        role="radiogroup"
        aria-label="Exchange rate source"
        className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
      >
        {(
          [
            ['live', 'Live (daily ECB)'],
            ['manual', 'Only my rates'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={family.rateMode === value}
            disabled={mode.isPending}
            onClick={() => family.rateMode !== value && mode.mutate(value)}
            className={clsx(
              'rounded-md px-3 py-1.5 text-sm font-medium',
              family.rateMode === value
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {live ? (
        <div className="mb-4 space-y-1 text-sm text-slate-500">
          <p>
            Official European Central Bank reference rates, downloaded once a day (only the rates
            are fetched; none of your data leaves this computer). Past months use their month-end
            rate. A rate you enter below wins for its month.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {status.data?.asOf
                ? `Rates from ${status.data.asOf}.`
                : download.isPending
                  ? 'Downloading rates…'
                  : 'No rates downloaded yet.'}
            </span>
            {status.data?.lastError && (
              <span className="text-amber-700 dark:text-amber-400">
                Last download failed: {status.data.lastError}
              </span>
            )}
            <Button variant="ghost" disabled={download.isPending} onClick={() => download.mutate()}>
              <RefreshCw size={14} aria-hidden /> Update now
            </Button>
          </p>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-500">
          One rate per month, used to convert between currencies (e.g. India spending into your EUR
          month). If a month has no rate, the latest earlier month is used.
        </p>
      )}
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
        <FormError error={save.error ?? remove.error ?? mode.error ?? download.error} />
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
              onClick={() =>
                window.confirm(`Delete the rate for ${monthLabel(r.month)}?`) && remove.mutate(r.id)
              }
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

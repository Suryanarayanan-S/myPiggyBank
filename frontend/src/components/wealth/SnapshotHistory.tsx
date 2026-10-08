import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Camera, History, Trash2 } from 'lucide-react';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AmountField } from './WealthForms';
import { api } from '../../lib/api';
import { AXIS, GRID, INK, SURFACE, axisTick, niceTicks } from '../../lib/chart';
import { formatCompact, formatMoney, parseAmountInput } from '../../lib/money';
import { localDay } from '../../lib/months';
import type { NetWorthResponse } from '../../lib/wealthTypes';

export function SnapshotHistory({
  data,
  wealthCurrency,
}: {
  data: NetWorthResponse;
  wealthCurrency: string;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  const [modal, setModal] = useState<'today' | 'past' | null>(null);
  const currency = data.current.currency;
  // Snapshots are saved in the wealth currency; one that could not be converted keeps its own
  // currency and stays out of the chart (it is still listed below).
  const snaps = data.snapshots.filter((s) => s.currency === currency);
  const editable = currency === wealthCurrency;
  const update = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.put(`/net-worth/snapshots/${id}`, { note: note || null }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/net-worth/snapshots/${id}`),
    onSuccess: refresh,
  });
  const values = snaps.map((s) => s.netWorth);
  const ticks = niceTicks(Math.max(0, ...values), Math.min(0, ...values));

  return (
    <>
      <ChartCard
        title="Net worth over time"
        subtitle="Saved snapshots and past entries with their notes"
        table={
          <DataTable
            head={['Date', 'Net worth', 'Note']}
            rows={data.snapshots.map((s) => [
              s.date,
              formatMoney(s.netWorth, s.currency),
              s.note ?? '',
            ])}
          />
        }
      >
        {!editable && (
          <p className="mb-4 text-sm text-slate-500">
            Shown in {currency}. Snapshots are saved in {wealthCurrency}; switch “Show in” to
            Default to add one.
          </p>
        )}
        <div className={editable ? 'mb-4 flex flex-wrap gap-2' : 'hidden'}>
          <Button onClick={() => setModal('today')}>
            <Camera size={16} aria-hidden /> Save today’s snapshot
          </Button>
          <Button variant="secondary" onClick={() => setModal('past')}>
            <History size={16} aria-hidden /> Add past entry
          </Button>
        </div>
        {snaps.length >= 2 && (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snaps} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis
                  dataKey="date"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={{ stroke: AXIS }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  ticks={ticks}
                  domain={[ticks[0]!, ticks.at(-1)!]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(v: number) => formatCompact(v, currency)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as (typeof snaps)[number] | undefined;
                    return (
                      <ChartTooltip
                        active={active}
                        title={p ? `${p.date}${p.note ? ` · ${p.note}` : ''}` : undefined}
                        rows={
                          p
                            ? [
                                {
                                  label: 'Net worth',
                                  value: formatMoney(p.netWorth, p.currency),
                                  color: INK,
                                },
                              ]
                            : []
                        }
                      />
                    );
                  }}
                />
                <Line
                  dataKey="netWorth"
                  type="linear"
                  stroke={INK}
                  strokeWidth={2}
                  dot={{ r: 4, fill: INK, stroke: SURFACE, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {[...data.snapshots].reverse().map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[6.5rem_7rem_1fr_auto]"
            >
              <span className="text-slate-500 tabular-nums">{s.date}</span>
              <span
                className="font-medium tabular-nums"
                title={formatMoney(s.netWorth, s.currency)}
              >
                {formatCompact(s.netWorth, s.currency)}
              </span>
              <input
                aria-label={`Note for ${s.date}`}
                defaultValue={s.note ?? ''}
                placeholder="Add a note"
                className="order-last col-span-3 min-w-0 rounded-md bg-transparent px-2 py-1 hover:bg-slate-100 focus:ring-1 focus:ring-indigo-500 focus:outline-none sm:order-none sm:col-span-1 dark:hover:bg-slate-800"
                onBlur={(e) =>
                  e.target.value !== (s.note ?? '') &&
                  update.mutate({ id: s.id, note: e.target.value.trim() })
                }
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <button
                type="button"
                aria-label={`Delete snapshot from ${s.date}`}
                className="p-1 text-slate-400 hover:text-rose-600"
                onClick={() =>
                  window.confirm(`Delete the snapshot from ${s.date}?`) && remove.mutate(s.id)
                }
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
          {data.snapshots.length === 0 && (
            <li className="py-2 text-slate-500">
              No snapshots yet. Save today’s, and add past entries from your old sheet.
            </li>
          )}
        </ul>
        <FormError error={update.error ?? remove.error} />
      </ChartCard>
      {modal && editable && (
        <Modal
          title={modal === 'today' ? 'Save today’s snapshot' : 'Add a past entry'}
          onClose={() => setModal(null)}
        >
          <SnapshotForm
            mode={modal}
            currency={wealthCurrency}
            netWorth={data.current.netWorth}
            unconverted={data.current.unconverted}
            onDone={async () => (await refresh(), setModal(null))}
          />
        </Modal>
      )}
    </>
  );
}

function SnapshotForm({
  mode,
  currency,
  netWorth,
  unconverted,
  onDone,
}: {
  mode: 'today' | 'past';
  currency: string;
  netWorth: number;
  unconverted: { currency: string; amount: number }[];
  onDone: () => void;
}) {
  const blocked = mode === 'today' && unconverted.length > 0;
  const [note, setNote] = useState('');
  const [date, setDate] = useState(localDay());
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.post('/net-worth/snapshots', body),
    onSuccess: onDone,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (mode === 'today') return save.mutate({ note: note || null });
        const value = parseAmountInput(amount);
        if (value === null) return setErr('Enter the net worth, e.g. 1.35 Cr or 135 L');
        setErr(null);
        save.mutate({ date, netWorth: value, note: note || null });
      }}
    >
      {mode === 'today' ? (
        blocked ? (
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
            {unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' and ')} cannot be
            converted to {currency} yet. Add this month’s exchange rate in Settings first, otherwise
            the snapshot would be too low.
          </p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Saves today’s net worth of <strong>{formatMoney(netWorth, currency)}</strong> with its
            breakdown.
          </p>
        )
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="snap-date">
            <Input
              id="snap-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <AmountField
            id="snap-amount"
            label={`Net worth (${currency})`}
            value={amount}
            onChange={setAmount}
            currency={currency}
            hint="e.g. 135 L or 1.35 Cr"
          />
        </div>
      )}
      <Field label="Note" htmlFor="snap-note" hint="What happened, e.g. “Car withdraw”">
        <Input id="snap-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {err && (
        <p role="alert" className="text-sm text-rose-600">
          {err}
        </p>
      )}
      <FormError error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending || blocked}>
          Save
        </Button>
      </div>
    </form>
  );
}

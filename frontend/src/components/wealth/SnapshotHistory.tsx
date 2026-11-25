import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History, Trash2 } from 'lucide-react';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AmountField } from './WealthForms';
import { api } from '../../lib/api';
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
  const [modal, setModal] = useState<'past' | null>(null);
  const currency = data.current.currency;
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

  return (
    <>
      <ChartCard
        title="Earlier history"
        subtitle="Net worth from before the app knew your accounts — e.g. from your old sheet. The line above leads in from these; every day since is worked out."
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
            Shown in {currency}. Past entries are saved in {wealthCurrency}; switch “Show in” to
            Default to add one.
          </p>
        )}
        <div className={editable ? 'mb-2 flex flex-wrap gap-2' : 'hidden'}>
          <Button variant="secondary" onClick={() => setModal('past')}>
            <History size={16} aria-hidden /> Add past entry
          </Button>
        </div>
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
                aria-label={`Delete entry from ${s.date}`}
                className="p-1 text-slate-400 hover:text-rose-600"
                onClick={() =>
                  window.confirm(`Delete the entry from ${s.date}?`) && remove.mutate(s.id)
                }
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
          {data.snapshots.length === 0 && (
            <li className="py-2 text-slate-500">
              None. Add past entries from your old sheet to see how it went before.
            </li>
          )}
        </ul>
        <FormError error={update.error ?? remove.error} />
      </ChartCard>
      {modal && editable && (
        <Modal title="Add a past entry" onClose={() => setModal(null)}>
          <SnapshotForm
            currency={wealthCurrency}
            onDone={async () => (await refresh(), setModal(null))}
          />
        </Modal>
      )}
    </>
  );
}

function SnapshotForm({ currency, onDone }: { currency: string; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
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
        const value = parseAmountInput(amount);
        if (value === null) return setErr('Enter the net worth, e.g. 1.35 Cr or 135 L');
        setErr(null);
        save.mutate({ date, netWorth: value, note: note || null });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="snap-date">
          <Input
            id="snap-date"
            type="date"
            required
            max={localDay()}
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
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

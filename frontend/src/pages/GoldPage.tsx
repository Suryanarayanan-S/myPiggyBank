import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Pencil, Plus } from 'lucide-react';
import { GoldForm, useGoldRefresh } from '../components/gold/GoldForm';
import { Tile } from '../components/investments/Tiles';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { dayLabel } from '../lib/deposits';
import { PURITY, formatGrams, useGold, type GoldItem } from '../lib/gold';
import { gainClass, signed } from '../lib/investments';
import { formatMoney } from '../lib/money';
import { localDay } from '../lib/months';
import { useMembers } from '../lib/queries';

const inr = (paise: number) => formatMoney(paise, 'INR');

/** Physical gold (jewellery, coins, bars) by weight, valued each day from the IBJA rate. */
export function GoldPage() {
  const q = useGold();
  const members = useMembers();
  const refresh = useGoldRefresh();
  const [dialog, setDialog] = useState<{ item?: GoldItem } | null>(null);
  const gone = useMutation({
    mutationFn: (g: GoldItem) => api.put(`/gold/${g.id}`, { closedAt: localDay() }),
    onSuccess: refresh,
  });
  const data = q.data;
  const s = data?.summary;
  const held = data?.items.filter((g) => g.status === 'held') ?? [];
  const closed = data?.items.filter((g) => g.status === 'closed') ?? [];
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? 'Shared') : 'Shared';
  const paid = held.reduce((t, g) => t + (g.boughtFor ?? 0), 0);
  const allPriced = held.every((g) => g.boughtFor !== null);

  const row = (g: GoldItem) => (
    <li key={g.id}>
      <Card className="!p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{g.name}</p>
            <p className="text-xs text-slate-500">{owner(g.ownerMemberId)}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {formatGrams(g.grams)} · {PURITY[g.purity]}
              {g.boughtOn && ` · bought ${dayLabel(g.boughtOn)}`}
              {g.boughtFor !== null && ` for ${inr(g.boughtFor)}`}
            </p>
            {g.closedAt && (
              <p className="text-xs text-slate-500">No longer held since {dayLabel(g.closedAt)}</p>
            )}
          </div>
          <div className="text-right text-sm tabular-nums">
            {g.value !== null && (
              <p>
                <span className="text-xs text-slate-500">Worth today </span>
                <span className="font-semibold">{inr(g.value)}</span>
              </p>
            )}
            {g.gain !== null && (
              <p className={clsx('text-xs', gainClass(g.gain))}>
                {signed(g.gain, 'INR')} since bought
              </p>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {g.status === 'held' && (
            <Button
              variant="ghost"
              aria-label={`No longer have it: ${g.name}`}
              onClick={() =>
                window.confirm(`Mark “${g.name}” as sold or given away? It stops counting.`) &&
                gone.mutate(g)
              }
            >
              No longer have it
            </Button>
          )}
          <Button
            variant="ghost"
            aria-label={`Edit ${g.name}`}
            onClick={() => setDialog({ item: g })}
          >
            <Pencil size={16} aria-hidden />
          </Button>
        </div>
      </Card>
    </li>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gold</h1>
          <p className="text-sm text-slate-500">
            Jewellery, coins and bars by weight, valued each day from the IBJA rate. Gold ETFs and
            bonds are under Market.
          </p>
        </div>
        <Button onClick={() => setDialog({})}>
          <Plus size={16} aria-hidden /> Add gold
        </Button>
      </div>
      <FormError error={q.error ?? gone.error} />
      {data &&
        (data.rate ? (
          <p className="text-xs text-slate-500">
            IBJA rate on {dayLabel(data.rate.date)}: {inr(Math.round(data.rate.perGram24k * 100))} a
            gram of 24K, {inr(Math.round(data.rate.perGram24k * 91.6))} of 22K.
            {data.rate.stale && (
              <span className="block text-amber-800 dark:text-amber-300">
                This rate is out of date: the daily prices (and with them the gold rate) seem to be
                switched off under Market.
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            No gold rate yet: it comes with the daily prices — switch on “Daily closing prices from
            NSE” under{' '}
            <Link to="/investments/market" className="font-medium underline">
              Market
            </Link>
            .
          </p>
        ))}
      {s && held.length > 0 && data?.rate && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile label="Worth today" value={formatMoney(s.value, s.currency)} />
          <Tile label="Weight" value={formatGrams(s.grams)} />
          {paid > 0 && (
            <Tile
              label="Paid, in ₹"
              value={inr(paid)}
              hint={allPriced ? undefined : 'for the pieces with a price'}
            />
          )}
        </div>
      )}
      {s && s.unconverted.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Not in the totals (no exchange rate to {s.currency}):{' '}
          {s.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
      {data && data.items.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No gold yet. Add a piece with its weight and purity: its value is worked out each day.
          </p>
        </Card>
      )}
      {held.length > 0 && <ul className="space-y-3">{held.map(row)}</ul>}
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            No longer held
          </h2>
          <ul className="space-y-3">{closed.map(row)}</ul>
        </section>
      )}
      {dialog && (
        <Modal title={dialog.item ? 'Edit gold' : 'Add gold'} onClose={() => setDialog(null)}>
          <GoldForm item={dialog.item} onDone={() => setDialog(null)} />
        </Modal>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Pencil, Plus } from 'lucide-react';
import { useMe } from '../auth/auth';
import { HoldingActivity, HoldingForm } from '../components/investments/HoldingDialogs';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import {
  HOLDING_KINDS,
  formatUnits,
  type Holding,
  type HoldingsResponse,
} from '../lib/investments';
import { formatMoney } from '../lib/money';
import { formatPercent } from '../lib/percent';
import { useMembers } from '../lib/queries';
import { useViewCurrency, withView } from '../lib/viewCurrency';

const signed = (cents: number, currency: string) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${formatMoney(Math.abs(cents), currency)}`;
const gainClass = (n: number | null) =>
  n === null || n === 0
    ? 'text-slate-600 dark:text-slate-300'
    : n > 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-rose-700 dark:text-rose-400';

export function InvestmentsPage() {
  const me = useMe();
  const members = useMembers();
  const [view] = useViewCurrency();
  const data = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const [dialog, setDialog] = useState<
    { kind: 'form'; holding?: Holding } | { kind: 'activity'; id: string } | null
  >(null);
  const close = () => setDialog(null);
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? 'Shared') : 'Shared';
  const s = data.data?.summary;
  const open = data.data?.holdings.filter((h) => !h.archived) ?? [];
  const archived = data.data?.holdings.filter((h) => h.archived) ?? [];
  const activity =
    dialog?.kind === 'activity' ? data.data?.holdings.find((h) => h.id === dialog.id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Investments</h1>
          <p className="text-sm text-slate-500">
            Stocks, ETFs, funds and gold — from your trades and the prices you enter. They count in
            net worth as investments.
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: 'form' })}>
          <Plus size={16} aria-hidden /> Add holding
        </Button>
      </div>
      <FormError error={data.error} />

      {s && open.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Value" value={formatMoney(s.value, s.currency)} />
            <Tile
              label="Invested"
              value={formatMoney(s.invested, s.currency)}
              hint="cost of what you hold"
            />
            <Tile
              label="Gain / loss"
              value={signed(s.unrealised, s.currency)}
              hint={
                s.invested > 0
                  ? formatPercent(Math.round((s.unrealised * 10_000) / s.invested))
                  : undefined
              }
              tone={s.unrealised}
            />
            <Tile
              label="Dividends"
              value={formatMoney(s.dividends, s.currency)}
              hint={`sold: ${signed(s.realised, s.currency)}`}
            />
          </div>
          {open.some((h) => h.currency !== s.currency) && (
            <p className="text-xs text-slate-500">
              Totals in {s.currency} use today’s exchange rates, also for past sales and dividends.
            </p>
          )}
          {s.unconverted.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              Not in the totals (no exchange rate to {s.currency}):{' '}
              {s.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
            </p>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <Shares
              title="By kind"
              currency={s.currency}
              rows={s.byKind.map((k) => ({ label: HOLDING_KINDS[k.kind], value: k.value }))}
            />
            <Shares
              title="By person"
              currency={s.currency}
              rows={s.byMember.map((m) => ({ label: m.name, value: m.value }))}
            />
          </div>
        </>
      )}

      {data.data && data.data.holdings.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No holdings yet. Add your ETFs, stocks or gold, then enter the buys from your depot
            statement. Recurring deposits, FDs and saving schemes fit better as assets on the Wealth
            page.
          </p>
        </Card>
      )}
      {open.length > 0 && <HoldingsTable list={open} owner={owner} onOpen={setDialog} />}
      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Archived</h2>
          <HoldingsTable list={archived} owner={owner} onOpen={setDialog} />
        </section>
      )}

      {dialog?.kind === 'form' && (
        <Modal
          title={dialog.holding ? `Edit ${dialog.holding.name}` : 'New holding'}
          onClose={close}
        >
          <HoldingForm
            holding={dialog.holding}
            defaultCurrency={me.data?.family.spendingCurrency ?? 'EUR'}
            onDone={close}
          />
        </Modal>
      )}
      {activity && (
        <Modal title={`Trades · ${activity.name}`} onClose={close}>
          <HoldingActivity holding={activity} onDone={close} />
        </Modal>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
}) {
  return (
    <Card className="!p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={clsx(
          'mt-1 text-xl font-semibold tabular-nums',
          tone !== undefined && gainClass(tone),
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

/** One quantity split into parts: ranked bars in a single colour, values written out. */
function Shares({
  title,
  currency,
  rows,
}: {
  title: string;
  currency: string;
  rows: { label: string; value: number }[];
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <Card title={title}>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums">
                {formatMoney(r.value, currency)}{' '}
                <span className="text-slate-500">
                  {total > 0 ? formatPercent(Math.round((r.value * 10_000) / total)) : ''}
                </span>
              </span>
            </div>
            <div aria-hidden className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total > 0 ? (r.value / total) * 100 : 0}%`,
                  background: 'var(--c-single)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HoldingsTable({
  list,
  owner,
  onOpen,
}: {
  list: Holding[];
  owner: (id: string | null) => string;
  onOpen: (d: { kind: 'form'; holding: Holding } | { kind: 'activity'; id: string }) => void;
}) {
  return (
    <>
      {/* Phones: one card per holding (a 7-column table does not fit). */}
      <ul className="space-y-3 md:hidden">
        {list.map((h) => (
          <li key={h.id}>
            <Card className="!p-4">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onOpen({ kind: 'activity', id: h.id })}
                >
                  <span className="block font-medium break-words">{h.name}</span>
                  <span className="block text-xs text-slate-500">
                    {HOLDING_KINDS[h.kind]} · {formatUnits(h.units)} units ·{' '}
                    {owner(h.ownerMemberId)}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  aria-label={`Edit ${h.name}`}
                  onClick={() => onOpen({ kind: 'form', holding: h })}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {h.value === null ? '—' : formatMoney(h.value, h.currency)}
                </span>
                <span className={clsx('text-right text-sm tabular-nums', gainClass(h.unrealised))}>
                  {h.unrealised === null ? '—' : signed(h.unrealised, h.currency)}
                  {h.returnBp !== null && ` · ${formatPercent(h.returnBp)}`}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {h.price ? `${formatUnits(h.price)} ${h.currency}` : 'no price yet'}
                  {h.priceDate &&
                    ` · ${h.priceSource === 'trade' ? 'last trade ' : ''}${h.priceDate}`}
                </span>
                <Button
                  variant="secondary"
                  className="!py-1"
                  onClick={() => onOpen({ kind: 'activity', id: h.id })}
                >
                  Trades
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Card className="hidden !p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Holding</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Avg. cost</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">Gain / loss</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => onOpen({ kind: 'activity', id: h.id })}
                    >
                      {h.name}
                    </button>
                    <span className="block text-xs text-slate-500">
                      {HOLDING_KINDS[h.kind]}
                      {h.symbol && ` · ${h.symbol}`} · {owner(h.ownerMemberId)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatUnits(h.units)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {h.avgCost ? `${formatUnits(h.avgCost)} ${h.currency}` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {h.price ? `${formatUnits(h.price)} ${h.currency}` : '—'}
                    {h.priceDate && (
                      <span className="block text-xs text-slate-500">
                        {h.priceSource === 'trade' ? 'last trade ' : ''}
                        {h.priceDate}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">
                    {h.value === null ? '—' : formatMoney(h.value, h.currency)}
                  </td>
                  <td
                    className={clsx('px-3 py-3 text-right tabular-nums', gainClass(h.unrealised))}
                  >
                    {h.unrealised === null ? '—' : signed(h.unrealised, h.currency)}
                    {h.returnBp !== null && (
                      <span className="block text-xs">{formatPercent(h.returnBp)}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Button
                      variant="secondary"
                      className="!py-1"
                      onClick={() => onOpen({ kind: 'activity', id: h.id })}
                    >
                      Trades
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${h.name}`}
                      onClick={() => onOpen({ kind: 'form', holding: h })}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

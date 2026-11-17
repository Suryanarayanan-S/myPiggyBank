import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus } from 'lucide-react';
import { useMe } from '../auth/auth';
import { DepositForm, useDepositRefresh } from '../components/deposits/DepositForm';
import { Tile } from '../components/investments/Tiles';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import {
  COMPOUNDING,
  dayLabel,
  formatRateBp,
  paidOutOn,
  useDeposits,
  whenLeft,
  type Deposit,
} from '../lib/deposits';
import { formatMoney } from '../lib/money';
import { localDay } from '../lib/months';
import { useAccounts, useMembers } from '../lib/queries';

const STATUS: Record<Deposit['status'], { label: string; tone: string }> = {
  upcoming: {
    label: 'Starts later',
    tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  active: {
    label: 'Running',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  },
  matured: {
    label: 'Matured',
    tone: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  closed: {
    label: 'Paid out',
    tone: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  },
};

const TEXT = {
  fd: {
    title: 'Fixed deposits',
    intro: 'valued each day from their rate',
    add: 'Add fixed deposit',
    edit: 'Edit fixed deposit',
    empty:
      'No fixed deposits yet. Add one with its amount, rate and dates: its value today and at maturity are worked out for you.',
  },
  rd: {
    title: 'Recurring deposits',
    intro: 'a monthly instalment, each one earning from its month',
    add: 'Add recurring deposit',
    edit: 'Edit recurring deposit',
    empty:
      'No recurring deposits yet. Add one with its monthly instalment, rate and months; the instalment can be booked from its account each month.',
  },
  savings: {
    title: 'Instant-access savings',
    intro: 'money in and out at any time, interest earned every day',
    add: 'Add instant-access savings',
    edit: 'Edit instant-access savings',
    empty:
      'No instant-access savings yet (Tagesgeld, a sweep or savings pot). Add one with its rate; then link the transactions that pay into it or take money out.',
  },
} as const;

const COUNTS = {
  fd: 'They count in net worth as investments until paid out.',
  rd: 'They count in net worth as investments until paid out.',
  savings: 'They count in net worth as money at hand.',
} as const;

/** "1 Feb 2026 · To savings · +₹2,000" rows of a deposit's linked transactions. */
function Movements({ d }: { d: Deposit }) {
  const sv = d.kind === 'savings';
  if (d.movements.length === 0) {
    return sv ? (
      <p className="mt-2 text-xs text-slate-500">
        Link transactions to it on the Transactions page: a payment into it adds, income from it
        takes out.
      </p>
    ) : null;
  }
  const n = d.movements.length;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
        {n} linked transaction{n === 1 ? '' : 's'}
      </summary>
      <ul className="mt-1 max-h-60 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {d.movements.map((m) => (
          <li key={m.transactionId} className="flex items-baseline justify-between gap-3 py-1">
            <span className="min-w-0 truncate">
              <span className="text-slate-500 tabular-nums">{dayLabel(m.date)}</span>{' '}
              {m.label ?? (m.amount > 0 ? 'Paid in' : 'Paid back')}
            </span>
            <span
              className={clsx(
                'shrink-0 tabular-nums',
                m.amount < 0 && 'text-rose-700 dark:text-rose-400',
              )}
            >
              {m.amount > 0 ? '+' : '−'}
              {formatMoney(Math.abs(m.amount), d.currency)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Fixed or recurring deposits: what each is worth today, what it pays at maturity, and when. */
export function DepositsPage({ kind }: { kind: Deposit['kind'] }) {
  const sv = kind === 'savings';
  const text = TEXT[kind];
  const me = useMe();
  const q = useDeposits();
  const accounts = useAccounts();
  const members = useMembers();
  const refresh = useDepositRefresh();
  const [dialog, setDialog] = useState<{ deposit?: Deposit } | null>(null);
  const paidOut = useMutation({
    mutationFn: (d: Deposit) =>
      api.put(`/deposits/${d.id}`, { closedAt: paidOutOn(d, localDay()) }),
    onSuccess: refresh,
  });
  const data = q.data;
  const mine = data?.deposits.filter((d) => d.kind === kind) ?? [];
  const open = mine.filter((d) => d.status !== 'closed');
  const closed = mine.filter((d) => d.status === 'closed');
  // This kind's totals in the summary currency (and what has no exchange rate to it).
  const s = data && {
    currency: data.summary.currency,
    value: mine.reduce((t, d) => t + (d.inView?.value ?? 0), 0),
    principal: mine.reduce((t, d) => t + (d.inView?.principal ?? 0), 0),
    unconverted: mine
      .filter((d) => d.value !== null && d.inView === null)
      .map((d) => ({ currency: d.currency, amount: d.value! })),
  };
  const accountName = (id: string | null) => accounts.data?.find((a) => a.id === id)?.name;
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? 'Shared') : 'Shared';

  const row = (d: Deposit) => (
    <li key={d.id}>
      <Card className="!p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {d.name}
              <span className={clsx('rounded px-1.5 py-0.5 text-xs', STATUS[d.status].tone)}>
                {sv && d.status === 'closed' ? 'Closed' : STATUS[d.status].label}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {[accountName(d.accountId), owner(d.ownerMemberId)].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {d.kind === 'savings' ? (
                <>
                  {formatMoney(d.principal, d.currency)} put in, at {formatRateBp(d.rateBp)} ·
                  interest daily, credited {COMPOUNDING[d.compounding].toLowerCase()} · since{' '}
                  {dayLabel(d.startDate)}
                </>
              ) : (
                <>
                  {d.kind === 'rd'
                    ? `${formatMoney(d.instalment!, d.currency)} a month × ${d.months}`
                    : formatMoney(d.principal, d.currency)}{' '}
                  at {formatRateBp(d.rateBp)} · {COMPOUNDING[d.compounding].toLowerCase()} ·{' '}
                  {dayLabel(d.startDate)} → {dayLabel(d.maturityDate!)}
                </>
              )}
            </p>
            {d.rates && d.rates.length > 1 && (
              <p className="text-xs text-slate-500">
                Rate:{' '}
                {d.rates
                  .map((r) => `${formatRateBp(r.rateBp)} from ${dayLabel(r.from)}`)
                  .join(', ')}
              </p>
            )}
            {d.kind === 'rd' && d.status !== 'closed' && (
              <p className="text-xs text-slate-500">
                {d.instalmentsDue} of {d.months} instalments paid ·{' '}
                {formatMoney(d.principal, d.currency)} put in
                {d.book ? ' · booked from the account each month' : ''}
              </p>
            )}
            {d.payoutPerPeriod !== null && (
              <p className="text-xs text-slate-500">
                Pays out {formatMoney(d.payoutPerPeriod, d.currency)} interest{' '}
                {COMPOUNDING[d.compounding].toLowerCase()}
              </p>
            )}
          </div>
          <div className="text-right text-sm tabular-nums">
            {d.value !== null && (
              <p>
                <span className="text-xs text-slate-500">Worth today </span>
                <span className="font-semibold">{formatMoney(d.value, d.currency)}</span>
              </p>
            )}
            {d.maturityAmount !== null && (
              <p>
                <span className="text-xs text-slate-500">At maturity </span>
                {formatMoney(d.maturityAmount, d.currency)}
              </p>
            )}
            {d.kind === 'savings' && d.interestEarned !== null && (
              <p>
                <span className="text-xs text-slate-500">Interest so far </span>
                {formatMoney(d.interestEarned, d.currency)}
              </p>
            )}
            {d.status !== 'closed' && d.daysLeft !== null && (
              <p className="text-xs text-slate-500">
                {d.daysLeft > 0 ? 'matures' : 'matured'} {whenLeft(d.daysLeft)}
              </p>
            )}
          </div>
        </div>
        <Movements d={d} />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {d.status === 'matured' && (
            <Button
              variant="secondary"
              aria-label={`Mark ${d.name} as paid out`}
              onClick={() => paidOut.mutate(d)}
              disabled={paidOut.isPending}
            >
              Mark as paid out
            </Button>
          )}
          {/* savings: once all the money is taken out, interest too (under one unit left), it
              can be closed */}
          {sv && d.status === 'active' && d.movements.length > 0 && (d.value ?? 0) < 100 && (
            <Button
              variant="secondary"
              aria-label={`Close ${d.name}`}
              onClick={() => paidOut.mutate(d)}
              disabled={paidOut.isPending}
            >
              Close it
            </Button>
          )}
          <Button
            variant="ghost"
            aria-label={`Edit ${d.name}`}
            onClick={() => setDialog({ deposit: d })}
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
          <h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1>
          <p className="text-sm text-slate-500">
            {text.title}, {text.intro}. {COUNTS[kind]}
          </p>
        </div>
        <Button onClick={() => setDialog({})}>
          <Plus size={16} aria-hidden /> {text.add}
        </Button>
      </div>
      <FormError error={q.error ?? paidOut.error} />
      {s && s.unconverted.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Not in the totals (no exchange rate to {s.currency}):{' '}
          {s.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
      {s && open.length > 0 && s.principal > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile label="Worth today" value={formatMoney(s.value, s.currency)} />
          <Tile label="Put in" value={formatMoney(s.principal, s.currency)} />
          <Tile
            label="Interest so far"
            value={formatMoney(s.value - s.principal, s.currency)}
            tone={s.value - s.principal}
          />
        </div>
      )}
      {data && mine.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">{text.empty}</p>
        </Card>
      )}
      {open.length > 0 && <ul className="space-y-3">{open.map(row)}</ul>}
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {sv ? 'Closed' : 'Paid out'}
          </h2>
          <ul className="space-y-3">{closed.map(row)}</ul>
        </section>
      )}
      {dialog && (
        <Modal title={dialog.deposit ? text.edit : text.add} onClose={() => setDialog(null)}>
          <DepositForm
            deposit={dialog.deposit}
            kind={kind}
            defaultCurrency={me.data?.family.wealthCurrency ?? 'INR'}
            onDone={() => setDialog(null)}
          />
        </Modal>
      )}
    </div>
  );
}

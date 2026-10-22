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

/** Fixed deposits: what each is worth today, what it pays at maturity, and when. */
export function DepositsPage() {
  const me = useMe();
  const q = useDeposits();
  const accounts = useAccounts();
  const members = useMembers();
  const refresh = useDepositRefresh();
  const [dialog, setDialog] = useState<{ deposit?: Deposit } | null>(null);
  const paidOut = useMutation({
    mutationFn: (d: Deposit) =>
      api.put(`/deposits/${d.id}`, {
        closedAt: d.maturityDate < localDay() ? d.maturityDate : localDay(),
      }),
    onSuccess: refresh,
  });
  const data = q.data;
  const s = data?.summary;
  const open = data?.deposits.filter((d) => d.status !== 'closed') ?? [];
  const closed = data?.deposits.filter((d) => d.status === 'closed') ?? [];
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
                {STATUS[d.status].label}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {[accountName(d.accountId), owner(d.ownerMemberId)].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {formatMoney(d.principal, d.currency)} at {formatRateBp(d.rateBp)} ·{' '}
              {COMPOUNDING[d.compounding].toLowerCase()} · {dayLabel(d.startDate)} →{' '}
              {dayLabel(d.maturityDate)}
            </p>
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
            <p>
              <span className="text-xs text-slate-500">At maturity </span>
              {formatMoney(d.maturityAmount, d.currency)}
            </p>
            {d.status !== 'closed' && (
              <p className="text-xs text-slate-500">
                {d.daysLeft > 0 ? 'matures' : 'matured'} {whenLeft(d.daysLeft)}
              </p>
            )}
          </div>
        </div>
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
          <h1 className="text-2xl font-semibold tracking-tight">Deposits</h1>
          <p className="text-sm text-slate-500">
            Fixed deposits, valued each day from their rate. They count in net worth as investments
            until paid out.
          </p>
        </div>
        <Button onClick={() => setDialog({})}>
          <Plus size={16} aria-hidden /> Add fixed deposit
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
      {data && data.deposits.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No deposits yet. Add a fixed deposit with its amount, rate and dates: its value today
            and at maturity are worked out for you.
          </p>
        </Card>
      )}
      {open.length > 0 && <ul className="space-y-3">{open.map(row)}</ul>}
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">Paid out</h2>
          <ul className="space-y-3">{closed.map(row)}</ul>
        </section>
      )}
      {dialog && (
        <Modal
          title={dialog.deposit ? 'Edit fixed deposit' : 'Add fixed deposit'}
          onClose={() => setDialog(null)}
        >
          <DepositForm
            deposit={dialog.deposit}
            defaultCurrency={me.data?.family.wealthCurrency ?? 'INR'}
            onDone={() => setDialog(null)}
          />
        </Modal>
      )}
    </div>
  );
}

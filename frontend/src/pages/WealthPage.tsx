import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import {
  AlertTriangle,
  ChevronDown,
  Coins,
  History,
  Home,
  Package,
  Pencil,
  Plus,
  TrendingUp,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMe } from '../auth/auth';
import { SnapshotHistory } from '../components/wealth/SnapshotHistory';
import { ValueChart } from '../components/charts/ValueChart';
import { netWorthPoints, useNetWorthHistory, useRange } from '../lib/history';
import { localDay } from '../lib/months';
import { AssetForm, HistoryForm, LiabilityForm } from '../components/wealth/WealthForms';
import { FamilyTree, MadeOf, ownerKey } from '../components/wealth/FamilyTree';
import { Wealth } from '../components/wealth/WealthOverview';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { useMembers } from '../lib/queries';
import {
  CLASSES,
  CLASS_COLOR,
  LIABILITY_TYPES,
  type Asset,
  type AssetClass,
  type Liability,
  type NetWorthResponse,
} from '../lib/wealthTypes';
import { useViewCurrency, withView } from '../lib/viewCurrency';

const CLASS_ICON: Record<AssetClass, LucideIcon> = {
  liquid: Wallet,
  property: Home,
  investment: Coins,
  other: Package,
};

/** A year before today (YYYY-MM-DD): a value older than this wants a fresh look. */
const yearAgo = () => {
  const d = new Date(`${localDay()}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
};
const longDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

type Dialog =
  | { kind: 'asset'; item?: Asset }
  | { kind: 'liability'; item?: Liability }
  | { kind: 'asset-history'; item: Asset }
  | { kind: 'liability-history'; item: Liability };

export function WealthPage() {
  const me = useMe();
  const members = useMembers();
  const [view] = useViewCurrency();
  const nw = useQuery({
    queryKey: ['net-worth', view],
    queryFn: () => api.get<NetWorthResponse>(withView('/net-worth', view)),
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: () => api.get<Asset[]>('/assets') });
  const liabilities = useQuery({
    queryKey: ['liabilities'],
    queryFn: () => api.get<Liability[]>('/liabilities'),
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const wealthCurrency = me.data?.family.wealthCurrency ?? 'INR';
  const currency = nw.data?.current.currency ?? wealthCurrency;
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? '—') : 'Shared';
  const close = () => setDialog(null);
  const [range, setRange] = useRange();
  const history = useNetWorthHistory(range);
  // the person chosen in the family tree: only their assets and loans below
  const [who, setWho] = useState<string | null>(null);
  const whoName =
    nw.data?.current.columns.find((col) => ownerKey(col.memberId) === who)?.name ?? null;
  const mine = <T extends { ownerMemberId: string | null }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => who === null || ownerKey(r.ownerMemberId) === who);
  const shownAssets = mine(assets.data);
  const shownLoans = mine(liabilities.data);
  const old = yearAgo();
  const forWhom = whoName && (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
      {whoName}
      <button
        type="button"
        aria-label="Show everyone's"
        onClick={() => setWho(null)}
        className="hover:text-amber-900 dark:hover:text-amber-100"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Family wealth</h1>
        <p className="text-sm text-slate-500">
          Accounts, assets and loans of the whole family, in {currency}. Bank accounts come from{' '}
          <Link to="/transactions/accounts" className="text-indigo-600 hover:underline">
            Transactions → Accounts
          </Link>
          .
        </p>
      </div>
      <FormError error={nw.error ?? assets.error ?? liabilities.error} />

      {nw.data && (
        <>
          {nw.data.current.unconverted.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {nw.data.current.unconverted
                    .map((u) => formatMoney(u.amount, u.currency))
                    .join(' and ')}{' '}
                  could not be converted to {currency} and is left out.{' '}
                  <Link to="/settings" className="font-medium underline">
                    Add an exchange rate
                  </Link>
                  .
                </span>
              </p>
            </Card>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <ValueChart
              className="lg:col-span-2"
              title="Family net worth"
              points={
                history.data?.currency === nw.data.current.currency
                  ? netWorthPoints(history.data)
                  : [{ date: localDay(), value: nw.data.current.netWorth }]
              }
              currency={nw.data.current.currency}
              range={range}
              onRange={setRange}
              note="Every day worked out from your accounts, investments, assets and loans — other currencies at today’s rates; before the app’s first day, your past entries."
            />
            <MadeOf c={nw.data.current} />
          </div>
          <FamilyTree c={nw.data.current} selected={who} onSelect={setWho} />
        </>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Assets"
          actions={
            <span className="flex items-center gap-2">
              {forWhom}
              <Button variant="secondary" onClick={() => setDialog({ kind: 'asset' })}>
                <Plus size={16} aria-hidden /> Add asset
              </Button>
            </span>
          }
        >
          <ul className="-my-1 space-y-1">
            {shownAssets.map((a) => {
              const Icon = CLASS_ICON[a.assetClass];
              const stale = a.valuedAt !== null && a.valuedAt < old;
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-xl py-1.5">
                  <span
                    aria-hidden
                    className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl"
                    style={{ color: CLASS_COLOR[a.assetClass] }}
                  >
                    <span className="absolute inset-0 bg-current opacity-15" />
                    <Icon size={17} className="relative" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block text-xs text-slate-500">
                      {CLASSES[a.assetClass]} · {owner(a.ownerMemberId)}
                      {a.valuedAt && (
                        <span className={clsx(stale && 'text-amber-700 dark:text-amber-400')}>
                          {' '}
                          · valued {longDay(a.valuedAt)}
                          {stale && ' — over a year ago'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="font-semibold">
                    {a.value === null ? '—' : <Wealth cents={a.value} currency={a.currency} />}
                  </span>
                  <span className="flex shrink-0">
                    <Button
                      variant="ghost"
                      aria-label={`Update value of ${a.name}`}
                      onClick={() => setDialog({ kind: 'asset-history', item: a })}
                    >
                      <TrendingUp size={16} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${a.name}`}
                      onClick={() => setDialog({ kind: 'asset', item: a })}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                  </span>
                </li>
              );
            })}
            {assets.data && shownAssets.length === 0 && (
              <li className="py-2 text-sm text-slate-500">
                {who === null
                  ? 'No assets yet: add property, land, FDs, stocks, gold…'
                  : `None entered for ${whoName} — their accounts and investments are on their own pages.`}
              </li>
            )}
          </ul>
        </Card>

        <Card
          title="Loans"
          actions={
            <span className="flex items-center gap-2">
              {forWhom}
              <Button variant="secondary" onClick={() => setDialog({ kind: 'liability' })}>
                <Plus size={16} aria-hidden /> Add loan
              </Button>
            </span>
          }
        >
          <ul className="-my-1 space-y-3">
            {shownLoans.map((l) => {
              // how much of the loan is paid off, when its original amount is known
              const paid =
                l.originalAmount && l.outstanding !== null && l.originalAmount > 0
                  ? Math.min(1, Math.max(0, 1 - l.outstanding / l.originalAmount))
                  : null;
              return (
                <li key={l.id} className="py-1">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block text-xs text-slate-500">
                        {LIABILITY_TYPES[l.type]} · {owner(l.ownerMemberId)}
                        {l.interestRate && ` · ${l.interestRate} %`}
                        {l.monthlyPayment !== null &&
                          ` · ${formatMoney(l.monthlyPayment, l.currency)}/month`}
                        {l.lender && ` · ${l.lender}`}
                      </span>
                    </span>
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {l.outstanding === null ? (
                        '—'
                      ) : (
                        <Wealth cents={l.outstanding} currency={l.currency} />
                      )}
                    </span>
                    <span className="flex shrink-0">
                      <Button
                        variant="ghost"
                        aria-label={`Update balance of ${l.name}`}
                        onClick={() => setDialog({ kind: 'liability-history', item: l })}
                      >
                        <TrendingUp size={16} aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Edit ${l.name}`}
                        onClick={() => setDialog({ kind: 'liability', item: l })}
                      >
                        <Pencil size={16} aria-hidden />
                      </Button>
                    </span>
                  </div>
                  {paid !== null && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span
                        role="meter"
                        aria-label={`${l.name}: paid off`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(paid * 100)}
                        aria-valuetext={`${Math.round(paid * 100)} % paid off`}
                        className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800"
                      >
                        <span
                          className="block h-full rounded-full bg-linear-to-r from-emerald-600 to-teal-300"
                          style={{ width: `${paid * 100}%` }}
                        />
                      </span>
                      <span>{Math.round(paid * 100)} % paid off</span>
                    </div>
                  )}
                </li>
              );
            })}
            {liabilities.data && shownLoans.length === 0 && (
              <li className="py-2 text-sm text-slate-500">
                {who === null ? 'No loans recorded.' : `No loans for ${whoName}.`}
              </li>
            )}
          </ul>
        </Card>
      </div>

      {nw.data && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium shadow-sm hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60 [&::-webkit-details-marker]:hidden">
            <History size={16} className="text-slate-500" aria-hidden />
            Earlier history
            <span className="text-slate-500">
              —{' '}
              {nw.data.snapshots.length === 0
                ? 'none yet'
                : `${nw.data.snapshots.length} ${nw.data.snapshots.length === 1 ? 'past entry' : 'past entries'}`}
            </span>
            <ChevronDown
              size={16}
              className="ml-auto text-slate-400 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-3">
            <SnapshotHistory data={nw.data} wealthCurrency={wealthCurrency} />
          </div>
        </details>
      )}

      {dialog?.kind === 'asset' && (
        <Modal title={dialog.item ? `Edit ${dialog.item.name}` : 'Add asset'} onClose={close}>
          <AssetForm asset={dialog.item} currency={wealthCurrency} onDone={close} />
        </Modal>
      )}
      {dialog?.kind === 'liability' && (
        <Modal title={dialog.item ? `Edit ${dialog.item.name}` : 'Add loan'} onClose={close}>
          <LiabilityForm liability={dialog.item} currency={wealthCurrency} onDone={close} />
        </Modal>
      )}
      {(dialog?.kind === 'asset-history' || dialog?.kind === 'liability-history') && (
        <Modal title={`${dialog.item.name}: value history`} onClose={close}>
          <HistoryForm
            kind={dialog.kind === 'asset-history' ? 'asset' : 'liability'}
            item={
              (dialog.kind === 'asset-history'
                ? assets.data?.find((a) => a.id === dialog.item.id)
                : liabilities.data?.find((l) => l.id === dialog.item.id)) ?? dialog.item
            }
            onDone={close}
          />
        </Modal>
      )}
    </div>
  );
}

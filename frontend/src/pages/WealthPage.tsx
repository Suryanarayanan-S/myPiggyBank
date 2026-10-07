import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, Pencil, Plus, TrendingUp } from 'lucide-react';
import { useMe } from '../auth/auth';
import { SnapshotHistory } from '../components/wealth/SnapshotHistory';
import { AssetForm, HistoryForm, LiabilityForm } from '../components/wealth/WealthForms';
import {
  AllocationBar,
  MemberTable,
  NetWorthHeader,
  Wealth,
} from '../components/wealth/WealthOverview';
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
  type Liability,
  type NetWorthResponse,
} from '../lib/wealthTypes';

type Dialog =
  | { kind: 'asset'; item?: Asset }
  | { kind: 'liability'; item?: Liability }
  | { kind: 'asset-history'; item: Asset }
  | { kind: 'liability-history'; item: Liability };

export function WealthPage() {
  const me = useMe();
  const members = useMembers();
  const nw = useQuery({
    queryKey: ['net-worth'],
    queryFn: () => api.get<NetWorthResponse>('/net-worth'),
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: () => api.get<Asset[]>('/assets') });
  const liabilities = useQuery({
    queryKey: ['liabilities'],
    queryFn: () => api.get<Liability[]>('/liabilities'),
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const currency = me.data?.family.wealthCurrency ?? 'INR';
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? '—') : 'Shared';
  const close = () => setDialog(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Family wealth</h1>
        <p className="text-sm text-slate-500">
          Accounts, assets and loans of the whole family, in {currency}. Bank accounts come from the
          Accounts page.
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
          <NetWorthHeader data={nw.data} />
          <MemberTable data={nw.data} />
          <AllocationBar data={nw.data} />
        </>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Assets"
          actions={
            <Button variant="secondary" onClick={() => setDialog({ kind: 'asset' })}>
              <Plus size={16} aria-hidden /> Add asset
            </Button>
          }
        >
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {assets.data?.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: CLASS_COLOR[a.assetClass] }}
                    />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="block text-xs text-slate-500">
                    {CLASSES[a.assetClass]} · {owner(a.ownerMemberId)}
                    {a.valuedAt && ` · valued ${a.valuedAt}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold">
                    {a.value === null ? '—' : <Wealth cents={a.value} currency={a.currency} />}
                  </span>
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
            ))}
            {assets.data?.length === 0 && (
              <li className="py-2 text-sm text-slate-500">
                No assets yet: add property, land, FDs, stocks, gold…
              </li>
            )}
          </ul>
        </Card>

        <Card
          title="Liabilities"
          actions={
            <Button variant="secondary" onClick={() => setDialog({ kind: 'liability' })}>
              <Plus size={16} aria-hidden /> Add loan
            </Button>
          }
        >
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {liabilities.data?.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.name}</span>
                  <span className="block text-xs text-slate-500">
                    {LIABILITY_TYPES[l.type]} · {owner(l.ownerMemberId)}
                    {l.interestRate && ` · ${l.interestRate} %`}
                    {l.monthlyPayment !== null &&
                      ` · ${formatMoney(l.monthlyPayment, l.currency)}/month`}
                    {l.lender && ` · ${l.lender}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="font-semibold">
                    {l.outstanding === null ? (
                      '—'
                    ) : (
                      <Wealth cents={l.outstanding} currency={l.currency} />
                    )}
                  </span>
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
              </li>
            ))}
            {liabilities.data?.length === 0 && (
              <li className="py-2 text-sm text-slate-500">No loans recorded.</li>
            )}
          </ul>
        </Card>
      </div>

      {nw.data && <SnapshotHistory data={nw.data} />}

      {dialog?.kind === 'asset' && (
        <Modal title={dialog.item ? `Edit ${dialog.item.name}` : 'Add asset'} onClose={close}>
          <AssetForm asset={dialog.item} currency={currency} onDone={close} />
        </Modal>
      )}
      {dialog?.kind === 'liability' && (
        <Modal title={dialog.item ? `Edit ${dialog.item.name}` : 'Add loan'} onClose={close}>
          <LiabilityForm liability={dialog.item} currency={currency} onDone={close} />
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

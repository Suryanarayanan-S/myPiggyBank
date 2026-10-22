import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus } from 'lucide-react';
import { useMe } from '../auth/auth';
import { AccountForm } from '../components/accounts/AccountForm';
import { Amount } from '../components/ui/Amount';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatMoney } from '../lib/money';
import { useAccounts, useMembers } from '../lib/queries';
import { ACCOUNT_TYPES, type Account } from '../lib/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Converted } from '../lib/dashboardTypes';
import { useViewCurrency, withView } from '../lib/viewCurrency';
import { useDeposits } from '../lib/deposits';

export function AccountsPage() {
  const me = useMe();
  const accounts = useAccounts();
  const [view] = useViewCurrency();
  const total = useQuery({
    queryKey: ['accounts', 'total', view],
    queryFn: () => api.get<Converted>(withView('/accounts/total', view)),
  });
  const currencies = new Set(
    (accounts.data ?? []).filter((a) => !a.archived).map((a) => a.currency),
  );
  const members = useMembers();
  // Fixed deposits made from an account show on it (their money is not in its balance).
  const deposits = useDeposits();
  const depositsOf = (id: string) =>
    (deposits.data?.deposits ?? []).filter((d) => d.accountId === id && d.status !== 'closed');
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const memberName = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? '—') : 'Shared';

  const byCurrency = new Map<string, Account[]>();
  for (const a of accounts.data ?? []) {
    byCurrency.set(a.currency, [...(byCurrency.get(a.currency) ?? []), a]);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden /> Add account
        </Button>
      </div>

      {accounts.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {accounts.data?.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No accounts yet. Add your bank accounts, cash and cards — e.g. Sparkasse (EUR) or ICICI
            (INR).
          </p>
        </Card>
      )}

      {total.data && (currencies.size > 1 || !currencies.has(total.data.currency)) && (
        <Card>
          <p className="text-sm text-slate-500">All open accounts in {total.data.currency}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatMoney(total.data.total, total.data.currency)}
          </p>
          {total.data.unconverted.length > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Plus{' '}
              {total.data.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' and ')}{' '}
              without an exchange rate.
            </p>
          )}
        </Card>
      )}

      {[...byCurrency].map(([currency, list]) => {
        const total = list.filter((a) => !a.archived).reduce((s, a) => s + a.balance, 0);
        return (
          <section key={currency} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                {currency} accounts
              </h2>
              <span className="text-sm text-slate-500">
                Total{' '}
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {formatMoney(total, currency)}
                </span>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((a) => (
                <Card key={a.id} className={a.archived ? 'opacity-60' : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{a.name}</p>
                      <p className="text-xs text-slate-500">
                        {ACCOUNT_TYPES[a.type]} · {memberName(a.ownerMemberId)}
                        {a.archived && ' · archived'}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label={`Edit ${a.name}`}
                      onClick={() => setEditing(a)}
                    >
                      <Pencil size={16} aria-hidden />
                    </Button>
                  </div>
                  <p className="mt-3 text-2xl font-semibold tabular-nums">
                    <Amount cents={a.balance} currency={a.currency} />
                  </p>
                  <p className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      <Amount cents={a.monthChange} currency={a.currency} signed /> this month
                    </span>
                    {/* The account's money in and out lives on the Transactions page. */}
                    <Link
                      to={`/transactions?accountId=${a.id}`}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      aria-label={`Transactions of ${a.name}`}
                    >
                      Transactions
                    </Link>
                  </p>
                  {depositsOf(a.id).length > 0 && (
                    <p className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800">
                      <span>
                        {depositsOf(a.id).length === 1
                          ? '1 fixed deposit'
                          : `${depositsOf(a.id).length} fixed deposits`}
                        :{' '}
                        <span className="tabular-nums">
                          {formatMoney(
                            depositsOf(a.id).reduce((t, d) => t + (d.value ?? d.principal), 0),
                            a.currency,
                          )}
                        </span>
                      </span>
                      <Link
                        to="/investments/deposits"
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        aria-label={`Fixed deposits of ${a.name}`}
                      >
                        Deposits
                      </Link>
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <Modal
          title={editing === 'new' ? 'Add account' : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <AccountForm
            account={editing === 'new' ? undefined : editing}
            defaultCurrency={me.data?.family.spendingCurrency ?? 'EUR'}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

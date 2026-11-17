import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { Button } from '../ui/Button';
import { FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';
import { dayLabel, useCandidates, type Deposit } from '../../lib/deposits';
import { formatMoney } from '../../lib/money';
import { useDepositRefresh } from './DepositForm';

/**
 * Ticks the payments into a deposit (and the money back from it) from its own card: the likely
 * ones first and marked, the rest searchable; linked in one go.
 */
export function LinkTransactions({ deposit, onDone }: { deposit: Deposit; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const list = useCandidates({ depositId: deposit.id, q: q.trim() || undefined });
  const refresh = useDepositRefresh();
  const save = useMutation({
    mutationFn: () => api.put(`/deposits/${deposit.id}/transactions`, { add: [...picked] }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const items = list.data?.items ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        A payment pays into {deposit.name}; income is money back from it. Only {deposit.currency}{' '}
        transactions not linked yet are listed.
      </p>
      <Input
        aria-label="Search transactions"
        placeholder="Search payee or note"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <FormError error={list.error ?? save.error} />
      {list.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-500">Nothing to link{q ? ' for this search' : ''}.</p>
      )}
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {items.map((t) => (
          <li key={t.id}>
            <label className="flex cursor-pointer items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={picked.has(t.id)}
                onChange={() => toggle(t.id)}
                aria-label={`${dayLabel(t.date)} ${t.text ?? ''} ${t.type === 'income' ? 'money back' : 'paid in'} ${formatMoney(t.amount, deposit.currency)}`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate">
                    {t.text ?? (t.type === 'income' ? 'Income' : 'Payment')}
                  </span>
                  {t.suggested && (
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                      Likely
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">
                  {dayLabel(t.date)}
                  {t.accountName && ` · ${t.accountName}`}
                </span>
              </span>
              <span
                className={clsx(
                  'shrink-0 tabular-nums',
                  t.type === 'income' && 'text-rose-700 dark:text-rose-400',
                )}
              >
                {t.type === 'income' ? '−' : '+'}
                {formatMoney(t.amount, deposit.currency)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={picked.size === 0 || save.isPending}>
          Link {picked.size || ''} {picked.size === 1 ? 'transaction' : 'transactions'}
        </Button>
      </div>
    </div>
  );
}

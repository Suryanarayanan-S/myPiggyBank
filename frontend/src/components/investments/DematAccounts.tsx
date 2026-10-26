import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { byDemat } from '../../lib/demat';
import { gainClass, signed, type Holding } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { useMembers } from '../../lib/queries';
import { NewDematForm, useDemats } from './DematPicker';

/**
 * Like a broker's sub-account breakdown: what each family member's demat cost and is worth, and
 * its share. Holdings in no demat yet are listed by person, with a way to move them into theirs.
 * Each row can be ticked off: the whole Market page then shows the ticked ones only.
 */
export function DematAccounts({
  holdings,
  currency,
  hidden,
  onHidden,
}: {
  /** every open holding (the rows stay, whatever is ticked) */
  holdings: Holding[];
  currency: string;
  /** keys of the rows ticked off */
  hidden: string[];
  onHidden: (keys: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const members = useMembers();
  const demats = useDemats();
  const [adding, setAdding] = useState(false);
  const rows = byDemat(holdings, new Set(demats.map((a) => a.id)));
  const move = useMutation({
    mutationFn: (accountId: string) =>
      api.post<{ moved: number }>('/holdings/move-to-demat', { accountId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings'] }),
  });
  if (rows.length === 0) return null;
  const person = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? '—') : 'Shared';
  const money = (c: number) => formatMoney(c, currency);
  const total = rows.reduce((t, r) => ({ cost: t.cost + r.cost, value: t.value + r.value }), {
    cost: 0,
    value: 0,
  });
  const totalBp =
    total.cost > 0 ? Math.round(((total.value - total.cost) * 10_000) / total.cost) : null;
  const loose = rows.some((r) => !r.accountId);
  // with one row there is nothing to choose
  const choose = rows.length > 1;
  const shown = rows.filter((r) => !hidden.includes(r.key));
  const toggle = (key: string) =>
    onHidden(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key].sort());

  return (
    <Card
      title="Demat accounts"
      actions={
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Add demat account
        </Button>
      }
    >
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Holdings by demat account</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
              <th scope="col" className="py-2 font-medium">
                {choose ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={hidden.length === 0}
                      // some shown: partly selected
                      ref={(el) => {
                        if (el) el.indeterminate = hidden.length > 0;
                      }}
                      // ticking every one off is not offered: it only selects all
                      onChange={() => onHidden([])}
                    />
                    Account <span className="font-normal">(select all)</span>
                  </label>
                ) : (
                  'Account'
                )}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Buy value
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Present value
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                P&amp;L
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Weight
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
            {rows.map((r) => {
              const demat = demats.find((a) => a.id === r.accountId);
              // where this person's loose holdings can go
              const theirs = demats.filter((a) => a.ownerMemberId === r.ownerMemberId);
              // a demat is its owner's, whoever its holdings were entered for
              const who = demat ? demat.ownerMemberId : r.ownerMemberId;
              return (
                <tr key={r.key} className={clsx(hidden.includes(r.key) && 'opacity-50')}>
                  <th scope="row" className="py-2.5 text-left font-normal">
                    <div className="flex items-start gap-2">
                      {choose && (
                        <input
                          type="checkbox"
                          className="mt-1"
                          aria-label={`Show ${person(who)} · ${demat ? demat.name : 'not in a demat account'}`}
                          checked={!hidden.includes(r.key)}
                          // the last one shown stays
                          disabled={!hidden.includes(r.key) && shown.length === 1}
                          title={
                            !hidden.includes(r.key) && shown.length === 1
                              ? 'At least one account stays shown'
                              : undefined
                          }
                          onChange={() => toggle(r.key)}
                        />
                      )}
                      <div>
                        <p className="font-medium">{person(who)}</p>
                        {demat ? (
                          <p className="text-xs text-slate-500">{demat.name}</p>
                        ) : theirs.length > 0 ? (
                          <Select
                            aria-label={`Move ${person(r.ownerMemberId)}’s holdings into a demat account`}
                            className="mt-1 !w-auto !py-1 !text-xs"
                            value=""
                            disabled={move.isPending}
                            onChange={(e) => e.target.value && move.mutate(e.target.value)}
                          >
                            <option value="">Not in a demat account — move into…</option>
                            {theirs.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Not in a demat account
                          </p>
                        )}
                      </div>
                    </div>
                  </th>
                  <td className="py-2.5 text-right">{money(r.cost)}</td>
                  <td className="py-2.5 text-right">{money(r.value)}</td>
                  <td className={clsx('py-2.5 text-right', gainClass(r.gain))}>
                    {signed(r.gain, currency)}
                    {r.returnBp !== null && (
                      <span className="block text-xs">
                        {r.returnBp >= 0 ? '+' : ''}
                        {formatPercent(r.returnBp)}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">{formatPercent(r.weightBp)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t border-slate-200 font-medium tabular-nums dark:border-slate-800">
                <th scope="row" className="py-2.5 text-left">
                  Total
                </th>
                <td className="py-2.5 text-right">{money(total.cost)}</td>
                <td className="py-2.5 text-right">{money(total.value)}</td>
                <td className={clsx('py-2.5 text-right', gainClass(total.value - total.cost))}>
                  {signed(total.value - total.cost, currency)}
                  {totalBp !== null && (
                    <span className="block text-xs">
                      {totalBp >= 0 ? '+' : ''}
                      {formatPercent(totalBp)}
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">100.0 %</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <FormError error={move.error} />
      {move.data && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          {move.data.moved === 1 ? '1 holding' : `${move.data.moved} holdings`} moved into the demat
          account.
        </p>
      )}
      {loose && (
        <p className="mt-3 text-xs text-slate-500">
          Add a demat account for each person (broker and client ID), then import their tradebook or
          holdings file into it — <span className="font-medium">Which demat is this?</span> in the
          import.
        </p>
      )}
      {adding && (
        <Modal title="Add demat account" onClose={() => setAdding(false)}>
          <NewDematForm onCancel={() => setAdding(false)} onCreated={() => setAdding(false)} />
        </Modal>
      )}
    </Card>
  );
}

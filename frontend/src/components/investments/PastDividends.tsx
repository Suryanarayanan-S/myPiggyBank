import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Field, FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { useMembers } from '../../lib/queries';

type Preview = {
  years: { year: string; count: number; amount: number; recorded: number }[];
  toAdd: { count: number; amount: number };
  recorded: number;
  rows: {
    symbol: string;
    date: string;
    units: number;
    perShare: number;
    amount: number;
    kind: string;
  }[];
  failed: string[];
  /** why, when NSE itself failed */
  problem: string | null;
};
type Result = { added: number; amount: number };

const inr = (paise: number) => formatMoney(paise, 'INR');

/**
 * Every dividend since the first trade, from NSE's history: shares held at the close before each
 * ex-date × the amount per share (like a broker's report), and gold bond interest.
 */
export function PastDividends({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const members = useMembers();
  // undefined: not chosen yet (the logged-in person); null: shared.
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  const ownerId = owner !== undefined ? owner : (members.data?.find((m) => m.isUser)?.id ?? null);
  const done = useRef<HTMLButtonElement>(null);
  const preview = useMutation({
    mutationFn: (who: string | null) =>
      api.post<Preview>('/holdings/past-dividends/preview', { ownerMemberId: who }),
    // the lookup also keeps the prices around splits and mergers
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings', 'events'] }),
  });
  const commit = useMutation({
    mutationFn: (who: string | null) =>
      api.post<Result>('/holdings/past-dividends/commit', { ownerMemberId: who }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holdings'] }),
  });
  useEffect(() => {
    if (commit.data) done.current?.focus();
  }, [commit.data]);
  const p = preview.data;

  if (commit.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Done: {commit.data.added} payouts added ({inr(commit.data.amount)}).
        </p>
        <div className="flex justify-end">
          <Button ref={done} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Looks up each share’s dividends in NSE’s history and works them out from the shares held on
        the day before each ex-date (before a split or bonus, the shares held then) — the way a
        broker’s report does. Gold bond interest comes from each series’ issue price: 2.5% a year, paid
        every six months (record a bond redeemed early as a sale first). Payouts already recorded are
        skipped. Amounts are before tax (TDS).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Whose holdings?" htmlFor="pd-owner">
          <Select
            id="pd-owner"
            value={ownerId ?? ''}
            onChange={(e) => {
              setOwner(e.target.value || null);
              preview.reset();
            }}
          >
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="">Shared</option>
          </Select>
        </Field>
        <Button
          variant="secondary"
          disabled={!members.data || preview.isPending}
          onClick={() => preview.mutate(ownerId)}
        >
          {preview.isPending ? 'Looking up… (up to two minutes the first time)' : 'Look up'}
        </Button>
      </div>
      <FormError error={preview.error ?? commit.error} />
      <p aria-live="polite" className="sr-only">
        {preview.isPending ? 'Looking up the history on NSE' : p ? 'Looked up' : ''}
      </p>
      {p && (
        <>
          {p.years.length === 0 ? (
            <p className="text-sm text-slate-500">No dividends found for these holdings.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Dividends to add, by year</caption>
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th scope="col" className="py-1 font-medium">
                    Year
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    To add
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Amount
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Already recorded
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {p.years.map((y) => (
                  <tr key={y.year} className="border-t border-slate-100 dark:border-slate-800">
                    <th scope="row" className="py-1 text-left font-normal">
                      {y.year}
                    </th>
                    <td className="py-1 text-right">{y.count}</td>
                    <td className="py-1 text-right">{inr(y.amount)}</td>
                    <td className="py-1 text-right text-slate-500">{y.recorded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.problem && (
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
              NSE did not answer as expected ({p.problem}). Try again later.
            </p>
          )}
          {p.failed.length > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              No history on NSE for {p.failed.join(', ')} (listed on BSE only, or renamed): their
              dividends are not included.
            </p>
          )}
          <div className="flex justify-end">
            <Button
              disabled={p.toAdd.count === 0 || commit.isPending}
              onClick={() => commit.mutate(ownerId)}
            >
              {p.toAdd.count === 0
                ? 'Nothing to add'
                : `Add ${p.toAdd.count} payouts (${inr(p.toAdd.amount)})`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

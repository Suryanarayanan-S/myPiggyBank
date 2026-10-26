import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Tile } from './Tiles';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { localDay } from '../../lib/months';
import {
  payoutCsv,
  payoutTotals,
  rangeOf,
  selectPayouts,
  type Payout,
  type PayoutKind,
  type PayoutSort,
  type Period,
} from '../../lib/payouts';
import { useRemembered } from '../../lib/remember';
import { useMembers } from '../../lib/queries';

const inr = (paise: number) => formatMoney(paise, 'INR');
const KINDS = ['dividend', 'interest', 'all'] as const;
const PERIODS = ['year', 'fy', 'lastFy', 'all', 'custom'] as const;
const PERIOD_LABEL: Record<Period, string> = {
  year: 'Last 12 months',
  fy: 'This financial year',
  lastFy: 'Last financial year',
  all: 'All years',
  custom: 'Choose days…',
};
const WORD: Record<PayoutKind, { one: string; many: string }> = {
  dividend: { one: 'dividend', many: 'dividends' },
  interest: { one: 'interest', many: 'interest payments' },
  all: { one: 'payout', many: 'payouts' },
};

/**
 * Where each dividend and interest payment came from and when: like Console's report — a type, a
 * period, the total, a searchable table (sorted by any column) and a CSV of what is shown.
 */
export function PayoutTable({
  holdingIds = null,
}: {
  /** only these holdings' (the demats chosen on the Market page); null: all */
  holdingIds?: Set<string> | null;
}) {
  const today = localDay();
  const members = useMembers();
  const list = useQuery({
    queryKey: ['holdings', 'payouts'],
    queryFn: () => api.get<Payout[]>('/holdings/payouts'),
  });
  const [kind, setKind] = useRemembered('pb-payout-kind', KINDS, 'dividend');
  const [period, setPeriod] = useRemembered('pb-payout-period', PERIODS, 'year');
  const [custom, setCustom] = useState<{ from: string | null; to: string | null }>(() =>
    rangeOf('year', today),
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ by: PayoutSort; desc: boolean }>({ by: 'date', desc: true });
  const range = period === 'custom' ? custom : rangeOf(period, today);
  const mine = useMemo(
    () => (list.data ?? []).filter((r) => !holdingIds || holdingIds.has(r.holdingId)),
    [list.data, holdingIds],
  );
  const rows = useMemo(
    () =>
      selectPayouts(mine, {
        kind,
        from: range.from,
        to: range.to,
        search,
        sort: sort.by,
        desc: sort.desc,
      }),
    [mine, kind, range.from, range.to, search, sort],
  );
  const totals = payoutTotals(rows);
  // the person's name when the family's payouts are on more than one person's holdings
  const owners = new Set(mine.map((r) => r.ownerMemberId));
  const ownerName = (id: string | null) => members.data?.find((m) => m.id === id)?.name ?? 'Shared';
  const word = WORD[kind];

  const download = () => {
    const blob = new Blob([payoutCsv(rows, kind)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind === 'all' ? 'payouts' : kind}_${range.from ?? 'start'}_to_${range.to ?? today}.csv`;
    a.click();
    // after the browser has taken it
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const header = (by: PayoutSort, label: string, right = true) => {
    const on = sort.by === by;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        className={right ? 'px-3 py-2 text-right font-medium' : 'px-4 py-2 font-medium'}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
          onClick={() => setSort(on ? { by, desc: !sort.desc } : { by, desc: by !== 'symbol' })}
        >
          {label}
          {on && <Arrow size={12} aria-hidden />}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Type" htmlFor="po-kind">
          <Select id="po-kind" value={kind} onChange={(e) => setKind(e.target.value as PayoutKind)}>
            <option value="dividend">Dividend</option>
            <option value="interest">Interest</option>
            <option value="all">Both</option>
          </Select>
        </Field>
        <Field label="Period" htmlFor="po-period">
          <Select
            id="po-period"
            value={period}
            onChange={(e) => {
              const next = e.target.value as Period;
              // a chosen range starts from what was shown
              if (next === 'custom' && period !== 'custom') {
                setCustom({ from: range.from ?? '2015-01-01', to: range.to ?? today });
              }
              setPeriod(next);
            }}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        {period === 'custom' && (
          <>
            <Field label="From" htmlFor="po-from">
              <Input
                id="po-from"
                type="date"
                value={custom.from ?? ''}
                max={custom.to ?? today}
                onChange={(e) => setCustom({ ...custom, from: e.target.value || null })}
              />
            </Field>
            <Field label="To" htmlFor="po-to">
              <Input
                id="po-to"
                type="date"
                value={custom.to ?? ''}
                min={custom.from ?? undefined}
                onChange={(e) => setCustom({ ...custom, to: e.target.value || null })}
              />
            </Field>
          </>
        )}
      </div>

      {range.from && range.to && range.from > range.to && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
          “From” is after “To”: nothing can be in between.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Tile label={`Total ${word.one}`} value={inr(totals.amount)} />
        <Tile label={`No. of ${word.many} received`} value={String(totals.count)} />
      </div>

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search by symbol or name</span>
            <Search
              size={16}
              aria-hidden
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              type="search"
              placeholder="Search…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Button variant="secondary" disabled={rows.length === 0} onClick={download}>
            <Download size={16} aria-hidden /> CSV
          </Button>
        </div>
        {list.isPending ? (
          <p className="px-4 pb-4 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500">
            No {word.many} {search ? 'match the search' : 'in this period'}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {word.many} from {range.from ?? 'the start'} to {range.to ?? today}
              </caption>
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                  {header('symbol', 'Symbol', false)}
                  {header('date', 'Ex-date')}
                  {header('units', 'Qty.')}
                  {header('perShare', kind === 'interest' ? 'Interest per bond' : 'Per share')}
                  {header('amount', 'Total')}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
                {rows.map((r, i) => (
                  <tr key={`${r.holdingId}|${r.date}|${r.kind}|${i}`}>
                    <th scope="row" className="px-4 py-2 text-left font-medium">
                      {r.symbol}
                      <span className="block text-xs font-normal text-slate-500">
                        {[
                          r.name !== r.symbol && r.name,
                          kind === 'all' && r.kind,
                          owners.size > 1 && ownerName(r.ownerMemberId),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right">{r.date}</td>
                    <td className="px-3 py-2 text-right">{r.units.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-right">
                      {r.perShare === null
                        ? '—'
                        : `₹${r.perShare.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{inr(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

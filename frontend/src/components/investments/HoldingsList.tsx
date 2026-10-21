import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Pencil } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import {
  HOLDING_KINDS,
  formatPrice,
  formatUnits,
  gainClass,
  signed,
  type Holding,
} from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import {
  dayChanges,
  listed,
  sortHoldings,
  type RankedHolding,
  type SortKey,
} from '../../lib/portfolio';

type Open = (d: { kind: 'form'; holding: Holding } | { kind: 'activity'; id: string }) => void;
const COLUMNS: { key: SortKey | null; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Instrument' },
  { key: 'units', label: 'Qty.', align: 'right' },
  { key: null, label: 'Avg. cost', align: 'right' },
  { key: null, label: 'Price', align: 'right' },
  { key: 'invested', label: 'Invested', align: 'right' },
  { key: 'value', label: 'Cur. value', align: 'right' },
  { key: 'pnl', label: 'P&L', align: 'right' },
  { key: 'pnlPct', label: 'Net chg.', align: 'right' },
  { key: 'dayPct', label: 'Day chg.', align: 'right' },
  { key: 'weight', label: 'Weight', align: 'right' },
];

/** Open holdings like a broker's holdings screen: search, filter and sort by any column. */
export function HoldingsList({
  holdings,
  currency,
  owner,
  onOpen,
}: {
  holdings: Holding[];
  /** the summary currency that Invested, value, P&L and weight are shown in */
  currency: string;
  owner: (id: string | null) => string;
  onOpen: Open;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [person, setPerson] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'value',
    dir: 'desc',
  });
  const all = listed(holdings, currency);
  // The latest market day's move; "—" for holdings without one (see dayChanges).
  const day = useMemo(() => dayChanges(holdings), [holdings]);
  const people = [...new Set(all.map((r) => owner(r.holding.ownerMemberId)))].sort();
  const kinds = [...new Set(all.map((r) => r.holding.kind))];
  const needle = q.trim().toLowerCase();
  const shown = sortHoldings(
    all.filter(
      (r) =>
        (!needle ||
          r.holding.name.toLowerCase().includes(needle) ||
          (r.holding.symbol ?? '').toLowerCase().includes(needle)) &&
        (!kind || r.holding.kind === kind) &&
        (!person || owner(r.holding.ownerMemberId) === person),
    ),
    sort.key,
    sort.dir,
    day.byId,
  );
  // Totals only add up what is in the summary currency (rows without a rate are listed apart).
  const total = shown
    .filter((r) => r.weightBp !== null)
    .reduce(
      (t, r) => ({
        cost: t.cost + r.cost,
        value: t.value + r.value,
        // the day's move, against the value before it of the holdings that moved
        day: t.day + (day.byId.get(r.holding.id)?.pnl ?? 0),
        dayBase: t.dayBase + (day.byId.has(r.holding.id) ? r.value : 0),
        moved: t.moved || day.byId.has(r.holding.id),
      }),
      { cost: 0, value: 0, day: 0, dayBase: 0, moved: false },
    );
  // The shown rows' share of the whole portfolio (not a sum of rounded weights).
  const portfolio = all.reduce((t, r) => t + (r.weightBp === null ? 0 : r.value), 0);
  const totalWeight = portfolio > 0 ? Math.round((total.value * 10_000) / portfolio) : 0;
  const money = (c: number, cur = currency) => formatMoney(c, cur);
  /** "—" for a holding with nothing bought yet. */
  const amount = (r: RankedHolding, c: number) => (r.empty ? '—' : money(c, r.currency));
  const pnl = (value: number, cost: number, cur = currency) => (
    <span className={gainClass(value - cost)}>{signed(value - cost, cur)}</span>
  );
  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  const apart = all.filter((r) => r.weightBp === null && !r.empty);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label="Search holdings"
          placeholder="Search, e.g. INFY"
          className="!w-48"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {kinds.length > 1 && (
          <Select
            aria-label="Kind"
            className="!w-auto"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {HOLDING_KINDS[k]}
              </option>
            ))}
          </Select>
        )}
        {people.length > 1 && (
          <Select
            aria-label="Person"
            className="!w-auto"
            value={person}
            onChange={(e) => setPerson(e.target.value)}
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        )}
        {/* Phones have no column headers to click: sort here. */}
        <Select
          aria-label="Sort by"
          className="!w-auto md:hidden"
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
            setSort({ key, dir });
          }}
        >
          <option value="value:desc">Largest first</option>
          <option value="pnlPct:desc">Best return first</option>
          <option value="pnlPct:asc">Worst return first</option>
          <option value="pnl:desc">Most gained first</option>
          <option value="dayPct:desc">Best day first</option>
          <option value="dayPct:asc">Worst day first</option>
          <option value="name:asc">A–Z</option>
        </Select>
        <span className="ml-auto text-xs text-slate-500" aria-live="polite">
          {shown.length} of {all.length} holdings
        </span>
      </div>

      <ul className="space-y-2 md:hidden">
        {shown.map((r) => (
          <li key={r.holding.id}>
            <Card className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => onOpen({ kind: 'activity', id: r.holding.id })}
                >
                  <span className="block font-medium break-words">{r.holding.name}</span>
                  <span className="block text-xs text-slate-500">
                    {r.empty
                      ? 'no trades yet'
                      : `${formatUnits(r.holding.units, r.holding.currency)} × ${
                          r.holding.avgCost
                            ? formatPrice(r.holding.avgCost, r.holding.currency)
                            : '—'
                        } ${r.holding.currency}`}
                    {r.weightBp !== null && ` · ${formatPercent(r.weightBp)} of portfolio`}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  className="!px-2"
                  aria-label={`Edit ${r.holding.name}`}
                  onClick={() => onOpen({ kind: 'form', holding: r.holding })}
                >
                  <Pencil size={16} aria-hidden />
                </Button>
              </div>
              <div className="mt-1 flex justify-end">
                <span className="text-right text-sm tabular-nums">
                  {amount(r, r.value)}
                  <span className="block text-xs">
                    {!r.empty && pnl(r.value, r.cost, r.currency)}{' '}
                    <span className={gainClass(r.holding.returnBp)}>
                      {r.holding.returnBp === null ? '' : formatPercent(r.holding.returnBp)}
                    </span>
                    {day.byId.has(r.holding.id) && (
                      <span
                        className={clsx('block', gainClass(day.byId.get(r.holding.id)!.changeBp))}
                      >
                        day {formatPercent(day.byId.get(r.holding.id)!.changeBp)}
                      </span>
                    )}
                  </span>
                </span>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="hidden !p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Holdings, sortable by column</caption>
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    aria-sort={
                      c.key && sort.key === c.key
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className={clsx(
                      'px-3 py-2 font-medium first:pl-4',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.key ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key!)}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        {c.label}
                        {sort.key === c.key &&
                          (sort.dir === 'asc' ? (
                            <ArrowUp size={12} aria-hidden />
                          ) : (
                            <ArrowDown size={12} aria-hidden />
                          ))}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((r) => {
                const h = r.holding;
                return (
                  <tr key={h.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 pl-4">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() => onOpen({ kind: 'activity', id: h.id })}
                      >
                        {h.name}
                      </button>
                      <span className="block text-xs text-slate-500">
                        {HOLDING_KINDS[h.kind]}
                        {h.symbol && h.symbol !== h.name && ` · ${h.symbol}`} ·{' '}
                        {owner(h.ownerMemberId)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatUnits(h.units, h.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {h.avgCost ? formatPrice(h.avgCost, h.currency) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {h.price ? formatPrice(h.price, h.currency) : '—'}
                      {h.currency !== currency && (
                        <span className="block text-xs text-slate-500">{h.currency}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{amount(r, r.cost)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {amount(r, r.value)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.empty ? '—' : pnl(r.value, r.cost, r.currency)}
                    </td>
                    <td
                      className={clsx('px-3 py-2 text-right tabular-nums', gainClass(h.returnBp))}
                    >
                      {h.returnBp === null ? '—' : formatPercent(h.returnBp)}
                    </td>
                    <td
                      className={clsx(
                        'px-3 py-2 text-right tabular-nums',
                        gainClass(day.byId.get(h.id)?.changeBp ?? null),
                      )}
                    >
                      {day.byId.has(h.id) ? formatPercent(day.byId.get(h.id)!.changeBp) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                      {r.weightBp === null ? '—' : formatPercent(r.weightBp)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        aria-label={`Edit ${h.name}`}
                        onClick={() => onOpen({ kind: 'form', holding: h })}
                      >
                        <Pencil size={16} aria-hidden />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {shown.length > 1 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold dark:border-slate-800">
                  <th scope="row" className="py-2 pr-3 pl-4 text-left">
                    Total
                  </th>
                  <td colSpan={3} />
                  <td className="px-3 py-2 text-right tabular-nums">{money(total.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(total.value)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pnl(total.value, total.cost)}
                  </td>
                  <td
                    className={clsx(
                      'px-3 py-2 text-right tabular-nums',
                      gainClass(total.value - total.cost),
                    )}
                  >
                    {total.cost > 0
                      ? formatPercent(
                          Math.round(((total.value - total.cost) * 10_000) / total.cost),
                        )
                      : '—'}
                  </td>
                  <td className={clsx('px-3 py-2 text-right tabular-nums', gainClass(total.day))}>
                    {total.moved && total.dayBase - total.day > 0
                      ? formatPercent(
                          Math.round((total.day * 10_000) / (total.dayBase - total.day)),
                        )
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500 tabular-nums">
                    {formatPercent(totalWeight)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
      {apart.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          No exchange rate to {currency}: {apart.map((r) => r.holding.name).join(', ')} — shown in
          their own currency, without a weight and outside the total.
        </p>
      )}
    </div>
  );
}

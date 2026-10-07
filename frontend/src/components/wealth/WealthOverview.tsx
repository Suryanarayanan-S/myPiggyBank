import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '../ui/Card';
import { formatCompact, formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import {
  CLASSES,
  CLASS_COLOR,
  type AssetClass,
  type NetWorthResponse,
} from '../../lib/wealthTypes';

const CLASS_KEYS = Object.keys(CLASSES) as AssetClass[];

/** A wealth figure: compact (₹1.26 Cr) with the exact amount on hover and for screen readers. */
export function Wealth({
  cents,
  currency,
  className,
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  const full = formatMoney(cents, currency);
  return (
    <span className={clsx('tabular-nums', className)} title={full}>
      <span aria-hidden>{formatCompact(cents, currency)}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

function Change({
  now,
  then,
  currency,
}: {
  now: number;
  then: { netWorth: number; date: string } | null;
  currency: string;
}) {
  if (!then) return null;
  const diff = now - then.netWorth;
  const Icon = diff >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={clsx(
        'flex items-center gap-1 text-sm',
        diff >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
      )}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      <span className="whitespace-nowrap">
        {diff >= 0 ? '+' : '−'}
        {formatCompact(Math.abs(diff), currency)}
      </span>
      <span className="text-slate-500">since {longDate(then.date)}</span>
    </p>
  );
}

export function NetWorthHeader({ data }: { data: NetWorthResponse }) {
  const c = data.current;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
      <Card>
        <p className="text-sm font-medium text-slate-500">Family net worth</p>
        <p className="text-5xl font-semibold tracking-tight">
          <Wealth cents={c.netWorth} currency={c.currency} />
        </p>
        <p className="mt-1 text-xs text-slate-500">{formatMoney(c.netWorth, c.currency)}</p>
        <div className="mt-2 space-y-0.5">
          <Change now={c.netWorth} then={data.previousMonth} currency={c.currency} />
          {data.previousYear && data.previousYear.date !== data.previousMonth?.date && (
            <Change now={c.netWorth} then={data.previousYear} currency={c.currency} />
          )}
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Assets</p>
          <p className="mt-1 text-xl font-semibold">
            <Wealth cents={c.assets} currency={c.currency} />
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Liabilities</p>
          <p className="mt-1 text-xl font-semibold">
            <Wealth cents={c.liabilities} currency={c.currency} />
          </p>
        </Card>
        <Card className="!p-4">
          <p className="text-xs font-medium text-slate-500">Debt ratio</p>
          <p className="mt-1 text-xl font-semibold">{formatPercent(c.debtRatioBp)}</p>
          <p className="text-xs text-slate-400">liabilities ÷ assets</p>
        </Card>
      </div>
    </div>
  );
}

/** The Financial Report layout: one column per family member, rows by asset class. */
export function MemberTable({ data }: { data: NetWorthResponse }) {
  const c = data.current;
  if (c.columns.length === 0) return null;
  const rows: { key: AssetClass | 'liabilities' | 'netWorth'; label: string }[] = [
    ...CLASS_KEYS.filter((k) => c.byClass[k] !== 0).map((k) => ({ key: k, label: CLASSES[k] })),
    ...(c.liabilities ? [{ key: 'liabilities' as const, label: 'Liabilities' }] : []),
    { key: 'netWorth', label: 'Net worth' },
  ];
  const total = (key: (typeof rows)[number]['key']) =>
    key === 'liabilities' ? c.liabilities : key === 'netWorth' ? c.netWorth : c.byClass[key];
  return (
    <Card title="By family member">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-2 font-medium" />
              {c.columns.map((col) => (
                <th key={col.memberId ?? 'shared'} className="py-2 text-right font-medium">
                  {col.name}
                </th>
              ))}
              <th className="py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
                Total
              </th>
              <th className="py-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={clsx(
                  'border-t border-slate-100 dark:border-slate-800',
                  r.key === 'netWorth' && 'font-semibold',
                )}
              >
                <th scope="row" className="py-2 text-left font-medium">
                  <span className="flex items-center gap-2">
                    {r.key in CLASSES && (
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: CLASS_COLOR[r.key as AssetClass] }}
                      />
                    )}
                    {r.label}
                  </span>
                </th>
                {c.columns.map((col) => {
                  const v = r.key === 'liabilities' ? -col.liabilities : col[r.key];
                  return (
                    <td key={col.memberId ?? 'shared'} className="py-2 text-right">
                      {v ? (
                        <Wealth cents={v} currency={c.currency} />
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 text-right font-semibold">
                  <Wealth
                    cents={r.key === 'liabilities' ? -total(r.key) : total(r.key)}
                    currency={c.currency}
                  />
                </td>
                <td className="py-2 text-right text-slate-500">
                  {r.key in CLASSES && c.assets > 0
                    ? formatPercent(Math.round((total(r.key) * 10_000) / c.assets))
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** 100 % bar of assets by class, every segment labelled (legend + %), with a 2px surface gap. */
export function AllocationBar({ data }: { data: NetWorthResponse }) {
  const c = data.current;
  const parts = CLASS_KEYS.filter((k) => c.byClass[k] > 0);
  const positive = parts.reduce((s, k) => s + c.byClass[k], 0);
  if (positive <= 0) return null;
  return (
    <Card title="Asset allocation">
      <div
        className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label="Asset allocation by class"
      >
        {parts.map((k) => (
          <div
            key={k}
            style={{ width: `${(c.byClass[k] / positive) * 100}%`, background: CLASS_COLOR[k] }}
            title={`${CLASSES[k]}: ${formatMoney(c.byClass[k], c.currency)}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {parts.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: CLASS_COLOR[k] }}
            />
            {CLASSES[k]}
            <span className="font-semibold tabular-nums">
              {((c.byClass[k] / positive) * 100).toFixed(1)} %
            </span>
            <span className="text-slate-500">
              <Wealth cents={c.byClass[k]} currency={c.currency} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { Dashboard } from '../../lib/dashboardTypes';
import { formatCompact, formatMoney } from '../../lib/money';
import { localDay } from '../../lib/months';
import { formatPercent } from '../../lib/percent';
import { Wealth } from '../wealth/WealthOverview';
import { Gauge } from '../charts/Ring';
import { CashFlowChart } from './CashFlowChart';
import { Sparkline } from './Sparkline';
import { Spikes } from './Spikes';

/** A change against the previous period, green when it went the good way. */
function Delta({ diff, upIsGood, text }: { diff: number; upIsGood: boolean; text: string }) {
  if (diff === 0) return <p className="text-xs text-slate-500">Same as previous period</p>;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={clsx(
        'flex items-center gap-1 text-xs',
        diff > 0 === upIsGood
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-rose-700 dark:text-rose-400',
      )}
    >
      <Icon size={14} className="shrink-0" aria-hidden />
      <span className="tabular-nums">
        {text} <span className="text-slate-500">vs previous period</span>
      </span>
    </p>
  );
}

/** One figure of the period; it opens Spending → Overview for the same period. */
function Cell({
  to,
  title,
  children,
  className,
}: {
  to: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        'group flex min-w-0 flex-col p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 dark:hover:bg-slate-800/40',
        className,
      )}
    >
      <h3 className="flex items-center gap-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">
        <span>{title}</span>
        <ChevronRight
          size={15}
          className="transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
        <span className="sr-only">— open Spending overview</span>
      </h3>
      {children}
    </Link>
  );
}

/**
 * The chosen period in one card: savings rate (a gauge), net income (a spike a month), spent (a
 * line) and net cashflow (money in against money out) side by side, and under them each month's
 * income and where it went.
 */
export function PeriodSummary({ d, to }: { d: Dashboard; to: string }) {
  const { totals: t, previous: p, currency } = d;
  // rounded (exact when rounding would hide it: a few cents are not "€0")
  const signed = (c: number) =>
    `${c > 0 ? '+' : '−'}${Math.abs(c) < 10_000 ? formatMoney(Math.abs(c), currency) : formatCompact(Math.abs(c), currency)}`;
  // month by month for the small graphs: whole months only (the running one would always end
  // low) and none before anything was recorded
  const thisMonth = localDay().slice(0, 7);
  const done = d.months.filter(
    (m) => m.month < thisMonth && (!d.firstMonth || m.month >= d.firstMonth),
  );
  const net = t.netIncome - t.spent;
  const before = p ? p.netIncome - p.spent : null;
  const widest = Math.max(1, t.netIncome, t.spent);
  const rateDiff =
    p?.savingsRateBp != null && t.savingsRateBp !== null ? t.savingsRateBp - p.savingsRateBp : null;
  const big = 'text-2xl font-semibold tracking-tight tabular-nums';
  return (
    <div
      role="group"
      aria-label="This period"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:bg-linear-to-b dark:from-white/[0.035] dark:to-transparent"
    >
      <div className="grid grid-cols-2 divide-slate-100 border-b border-slate-100 lg:grid-cols-4 lg:divide-x dark:divide-slate-800 dark:border-slate-800">
        <Cell to={to} title="Savings rate">
          <div className="mt-1 flex items-center gap-3">
            <Gauge fraction={Math.max(0, t.savingsRateBp ?? 0) / 10_000} size={68}>
              <span className="text-xs font-semibold tabular-nums">
                {formatPercent(t.savingsRateBp)}
              </span>
            </Gauge>
            <div className="min-w-0">
              {rateDiff !== null && (
                <Delta
                  diff={rateDiff}
                  upIsGood
                  text={`${rateDiff > 0 ? '+' : '−'}${(Math.abs(rateDiff) / 100).toFixed(1)} pp`}
                />
              )}
              <p className="mt-1 text-xs text-slate-500">of net income kept</p>
            </div>
          </div>
        </Cell>
        <Cell to={to} title="Net income">
          <p className={big}>
            <Wealth cents={t.netIncome} currency={currency} />
          </p>
          {p && (
            <Delta
              diff={t.netIncome - p.netIncome}
              upIsGood
              text={signed(t.netIncome - p.netIncome)}
            />
          )}
          <div className="mt-auto pt-2">
            <Spikes values={done.map((m) => m.netIncome)} height={28} />
          </div>
        </Cell>
        <Cell to={to} title="Spent">
          <p className={big}>
            <Wealth cents={t.spent} currency={currency} />
          </p>
          {p && (
            <Delta diff={t.spent - p.spent} upIsGood={false} text={signed(t.spent - p.spent)} />
          )}
          <div className="mt-auto pt-2">
            <Sparkline values={done.map((m) => m.spent)} upIsGood={false} height={32} />
          </div>
        </Cell>
        <Cell to={to} title="Net cashflow">
          <p
            className={clsx(
              big,
              net < 0
                ? 'text-rose-600 dark:text-rose-400'
                : net > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : undefined,
            )}
          >
            {net > 0 ? '+' : ''}
            <Wealth cents={net} currency={currency} />
          </p>
          {before !== null && <Delta diff={net - before} upIsGood text={signed(net - before)} />}
          <ul className="mt-auto space-y-1 pt-2 text-xs tabular-nums">
            {[
              { label: 'In', value: t.netIncome, bar: 'from-emerald-600 to-teal-300' },
              { label: 'Out', value: t.spent, bar: 'from-rose-600 to-pink-400' },
            ].map((r) => (
              <li key={r.label} className="flex items-center gap-2">
                <span className="w-6 text-slate-500">{r.label}</span>
                <span
                  aria-hidden
                  className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <span
                    className={`block h-full rounded-full bg-linear-to-r ${r.bar}`}
                    style={{ width: `${(Math.max(0, r.value) / widest) * 100}%` }}
                  />
                </span>
                <span className="w-14 text-right text-slate-600 dark:text-slate-300">
                  {formatCompact(r.value, currency)}
                </span>
              </li>
            ))}
          </ul>
        </Cell>
      </div>
      <div className="px-4 pt-3 pb-2">
        <CashFlowChart d={d} bare />
      </div>
    </div>
  );
}

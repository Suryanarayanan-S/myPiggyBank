import clsx from 'clsx';
import { Link } from 'react-router';
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { Dashboard, Totals } from '../../lib/dashboardTypes';
import { formatCompact, formatMoney } from '../../lib/money';
import { localDay } from '../../lib/months';
import { Wealth } from '../wealth/WealthOverview';
import { Sparkline } from './Sparkline';
import { formatPercent } from '../../lib/percent';
import { useBucketNames, type BucketNames } from '../../lib/buckets';

function Delta({ diff, upIsGood, text }: { diff: number; upIsGood: boolean; text: string }) {
  if (diff === 0) return <p className="mt-1 text-xs text-slate-500">Same as previous period</p>;
  const good = diff > 0 === upIsGood;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={clsx(
        'mt-1 flex items-start gap-1 text-xs',
        good ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
      )}
    >
      <Icon size={14} className="mt-px shrink-0" aria-hidden />
      <span>
        {text} <span className="text-slate-500">vs previous period</span>
      </span>
    </p>
  );
}

const tiles = (
  names: BucketNames,
): { key: keyof Totals; label: string; hint: string; upIsGood: boolean }[] => [
  { key: 'netIncome', label: 'Net income', hint: 'all income', upIsGood: true },
  { key: 'spent', label: 'Spent', hint: `${names.essentials} + ${names.fun}`, upIsGood: false },
  { key: 'future', label: names.future, hint: 'saved & invested', upIsGood: true },
  { key: 'unused', label: 'Unused', hint: 'left over', upIsGood: true },
];

/** The look of a card that is a link (as SummaryCard), at a tile's size. */
const TILE =
  'group block rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60';

/** The period's figures; each opens Spending → Overview for the same period (`to`). */
export function StatTiles({ d, to }: { d: Dashboard; to: string }) {
  const names = useBucketNames();
  const { totals: t, previous: p, currency } = d;
  // rounded like the cards above (the exact amount on hover and for screen readers)
  // (exact when rounding would hide it: a few cents are not "€0")
  const signed = (c: number) =>
    `${c > 0 ? '+' : '−'}${Math.abs(c) < 10_000 ? formatMoney(Math.abs(c), currency) : formatCompact(Math.abs(c), currency)}`;
  // month by month for the small graphs: whole months only (the running one would always end
  // low) and none before anything was recorded; a single month draws nothing
  const thisMonth = localDay().slice(0, 7);
  const done = d.months.filter(
    (m) => m.month < thisMonth && (!d.firstMonth || m.month >= d.firstMonth),
  );
  const series = (k: keyof Totals) => done.map((m) => (m[k] as number | null) ?? 0);
  const rateDiff =
    p?.savingsRateBp != null && t.savingsRateBp !== null ? t.savingsRateBp - p.savingsRateBp : null;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
      <Link to={to} className={clsx(TILE, 'flex flex-col justify-center p-5')}>
        <h2 className="flex items-center gap-0.5 text-sm font-medium text-slate-500">
          Savings rate
          <ChevronRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
          <span className="sr-only">— open Spending overview</span>
        </h2>
        <p className="text-5xl font-semibold tracking-tight">{formatPercent(t.savingsRateBp)}</p>
        <p className="mt-1 text-xs text-slate-500">({names.future} + unused) ÷ net income</p>
        {rateDiff !== null && (
          <Delta
            diff={rateDiff}
            upIsGood
            text={`${rateDiff > 0 ? '+' : '−'}${(Math.abs(rateDiff) / 100).toFixed(1)} pp`}
          />
        )}
        <div className="mt-2">
          <Sparkline
            values={done.filter((m) => m.savingsRateBp !== null).map((m) => m.savingsRateBp!)}
            height={44}
          />
        </div>
      </Link>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles(names).map((tile) => {
          const value = t[tile.key] as number;
          return (
            <Link key={tile.key} to={to} className={clsx(TILE, 'flex flex-col p-4')}>
              <p className="text-xs font-medium text-slate-500">{tile.label}</p>
              <p
                className={clsx(
                  'mt-1 text-2xl font-semibold tracking-tight',
                  value < 0 && 'text-rose-600 dark:text-rose-400',
                )}
              >
                <Wealth cents={value} currency={currency} />
              </p>
              <p className="text-xs text-slate-400">
                {tile.key === 'spent' && t.uncategorised > 0
                  ? `${names.essentials} + ${names.fun} + uncategorised`
                  : tile.hint}
              </p>
              {p && (
                <Delta
                  diff={value - (p[tile.key] as number)}
                  upIsGood={tile.upIsGood}
                  text={signed(value - (p[tile.key] as number))}
                />
              )}
              <div className="mt-auto pt-2">
                <Sparkline values={series(tile.key)} upIsGood={tile.upIsGood} height={40} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

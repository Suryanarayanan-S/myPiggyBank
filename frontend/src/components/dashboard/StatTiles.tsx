import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Dashboard, Totals } from '../../lib/dashboardTypes';
import { formatMoney } from '../../lib/money';
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

export function StatTiles({ d }: { d: Dashboard }) {
  const names = useBucketNames();
  const { totals: t, previous: p, currency } = d;
  const money = (c: number) => formatMoney(c, currency);
  const signed = (c: number) => `${c > 0 ? '+' : '−'}${money(Math.abs(c))}`;
  const rateDiff =
    p?.savingsRateBp != null && t.savingsRateBp !== null ? t.savingsRateBp - p.savingsRateBp : null;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(14rem,18rem)_1fr]">
      <Card className="flex flex-col justify-center">
        <p className="text-sm font-medium text-slate-500">Savings rate</p>
        <p className="text-5xl font-semibold tracking-tight">{formatPercent(t.savingsRateBp)}</p>
        <p className="mt-1 text-xs text-slate-500">({names.future} + unused) ÷ net income</p>
        {rateDiff !== null && (
          <Delta
            diff={rateDiff}
            upIsGood
            text={`${rateDiff > 0 ? '+' : '−'}${(Math.abs(rateDiff) / 100).toFixed(1)} pp`}
          />
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles(names).map((tile) => {
          const value = t[tile.key] as number;
          return (
            <Card key={tile.key} className="!p-4">
              <p className="text-xs font-medium text-slate-500">{tile.label}</p>
              <p
                className={clsx(
                  'mt-1 text-xl font-semibold',
                  value < 0 && 'text-rose-600 dark:text-rose-400',
                )}
              >
                {money(value)}
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
            </Card>
          );
        })}
      </div>
    </div>
  );
}

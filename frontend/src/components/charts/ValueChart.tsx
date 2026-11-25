import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { AreaLine, BAD, FLAT, GOOD, dayLabel } from './AreaLine';
import { Trend } from '../dashboard/SummaryCard';
import { Wealth } from '../wealth/WealthOverview';
import { formatCompact } from '../../lib/money';
import { RANGES, fromFirstValue, type Range } from '../../lib/history';

/**
 * A value over time, like a banking app: what it is worth now, how much that moved over the
 * range, a line with a dashed line where it started, and 1M · 6M · 1Y · All under it. The
 * points may be unevenly spaced (snapshots): the axis is time.
 */
export function ValueChart({
  title,
  points,
  currency,
  range,
  onRange,
  upIsGood = true,
  note,
  height = 220,
  className,
}: {
  title: string;
  points: { date: string; value: number }[];
  currency: string;
  range: Range;
  onRange: (r: Range) => void;
  upIsGood?: boolean;
  /** a line under the chart (e.g. what is left out) */
  note?: ReactNode;
  height?: number;
  className?: string;
}) {
  const data = fromFirstValue(points, (p) => p.value).map((p) => ({
    t: Date.parse(`${p.date}T00:00:00Z`),
    v: p.value,
  }));
  const first = data[0]?.v ?? 0;
  const last = data.at(-1)?.v ?? 0;
  const diff = last - first;
  const color = diff === 0 ? FLAT : diff > 0 === upIsGood ? GOOD : BAD;
  const long = RANGES.find((r) => r.key === range)!.long;
  const pct = first > 0 ? (diff / first) * 100 : null;
  return (
    <Card className={className}>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        <Wealth cents={last} currency={currency} />
      </p>
      {data.length > 1 && (
        <Trend diff={diff} upIsGood={upIsGood}>
          <span className="whitespace-nowrap tabular-nums">
            {diff > 0 ? '+' : diff < 0 ? '−' : ''}
            {formatCompact(Math.abs(diff), currency)}
            {pct !== null && ` (${Math.abs(pct).toFixed(1)} %)`}
          </span>
          <span className="text-slate-500">· {long}</span>
        </Trend>
      )}
      <div className="mt-3 min-w-0" style={{ height }}>
        {data.length > 1 ? (
          <AreaLine data={data} currency={currency} color={color} height={height} />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-slate-500">
            Not enough history yet for a line.
          </p>
        )}
      </div>
      {data.length > 1 && (
        <p className="mt-1 flex justify-between text-xs text-slate-500 tabular-nums">
          <span>{dayLabel(data[0]!.t, true)}</span>
          <span>{dayLabel(data.at(-1)!.t, true)}</span>
        </p>
      )}
      <div
        role="radiogroup"
        aria-label={`${title}: time range`}
        className="mt-3 flex flex-wrap items-center gap-1"
      >
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="radio"
            aria-checked={range === r.key}
            aria-label={r.long}
            onClick={() => onRange(r.key)}
            className={clsx(
              'rounded-full px-3 py-1 text-sm font-medium',
              range === r.key
                ? 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {note && <div className="mt-2 text-xs text-slate-500">{note}</div>}
    </Card>
  );
}

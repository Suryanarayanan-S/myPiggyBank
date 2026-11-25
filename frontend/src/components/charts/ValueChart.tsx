import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '../ui/Card';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { Trend } from '../dashboard/SummaryCard';
import { Wealth } from '../wealth/WealthOverview';
import { axisTick } from '../../lib/chart';
import { formatCompact, formatMoney } from '../../lib/money';
import { RANGES, fromFirstValue, type Range } from '../../lib/history';

const GOOD = '#10b981';
const BAD = '#f43f5e';
const FLAT = 'var(--c-muted)';

const dayLabel = (t: number, withYear: boolean) =>
  new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  });

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
  const gradient = useId().replace(/:/g, '');
  const data = fromFirstValue(points, (p) => p.value).map((p) => ({
    t: Date.parse(`${p.date}T00:00:00Z`),
    v: p.value,
  }));
  const first = data[0]?.v ?? 0;
  const last = data.at(-1)?.v ?? 0;
  const diff = last - first;
  const color = diff === 0 ? FLAT : diff > 0 === upIsGood ? GOOD : BAD;
  const long = RANGES.find((r) => r.key === range)!.long;
  const spanYears = data.length > 1 && data.at(-1)!.t - data[0]!.t > 300 * 86_400_000;
  const values = data.map((d) => d.v);
  const lo = Math.min(...values, first);
  const hi = Math.max(...values, first);
  const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.1;
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
      <div className="mt-3 min-w-0 overflow-hidden" style={{ height }}>
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(t: number) => dayLabel(t, spanYears)}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis hide domain={[lo - pad, hi + pad]} />
              <ReferenceLine
                y={first}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeDasharray="4 4"
              />
              <Tooltip
                cursor={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as { t: number; v: number } | undefined;
                  return (
                    <ChartTooltip
                      active={active && !!p}
                      title={p ? dayLabel(p.t, true) : undefined}
                      rows={p ? [{ label: '', value: formatMoney(p.v, currency), color }] : []}
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradient})`}
                isAnimationActive={false}
                activeDot={{ r: 4, fill: color, stroke: 'none' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-slate-500">
            Not enough history yet for a line.
          </p>
        )}
      </div>
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

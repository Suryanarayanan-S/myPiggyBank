import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { GlowEnd } from './Glow';
import { formatMoney } from '../../lib/money';

export const GOOD = '#10b981';
export const BAD = '#f43f5e';
export const FLAT = 'var(--c-muted)';
const MARGIN = { top: 12, right: 12, bottom: 0, left: 12 };

export const dayLabel = (t: number, withYear: boolean) =>
  new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear && { year: 'numeric' }),
    timeZone: 'UTC',
  });

/**
 * A value over time on a faint grid, no axes: a gradient under the line, a dashed line where it
 * started, the latest point lit up, and the date and value on hover. The points may be unevenly
 * spaced (snapshots): the axis is time. Needs at least two points.
 */
export function AreaLine({
  data,
  currency,
  color,
  height,
  decorative = false,
}: {
  data: { t: number; v: number }[];
  currency: string;
  color: string;
  height: number;
  /** inside a link: no keyboard stop or tooltip widget, hidden from screen readers */
  decorative?: boolean;
}) {
  const gradient = useId().replace(/:/g, '');
  const first = data[0]?.v ?? 0;
  const values = data.map((d) => d.v);
  const lo = Math.min(...values, first);
  const hi = Math.max(...values, first);
  const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.1;
  return (
    <div
      className="min-w-0 overflow-hidden"
      style={{ height }}
      aria-hidden={decorative || undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={MARGIN} accessibilityLayer={!decorative}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* a faint grid both ways, no axis: the dates are under the chart and on hover */}
          <CartesianGrid stroke="var(--c-grid)" strokeOpacity={0.7} />
          <XAxis
            hide
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickCount={6}
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
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.index === data.length - 1 && p.cx != null && p.cy != null ? (
                <GlowEnd
                  key="end"
                  cx={p.cx}
                  cy={p.cy}
                  color={color}
                  floor={height - MARGIN.bottom}
                />
              ) : (
                <g key={`d${p.index}`} />
              )
            }
            activeDot={{ r: 5, fill: '#fff', stroke: color, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import clsx from 'clsx';
import { useMe } from '../../auth/auth';
import { Card } from '../ui/Card';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { AXIS, GRID, SINGLE, SURFACE, axisTick, niceTicks } from '../../lib/chart';
import { api } from '../../lib/api';
import type { Holding } from '../../lib/investments';
import { formatCompact, formatMoney } from '../../lib/money';
import { compareSince, oneCurrency, returnIndex, valueHistory } from '../../lib/portfolio';

type Point = { date: string; value: number };
type Benchmarks = { nifty50: Point[]; gold: Point[] };

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const pct = (bp: number | null) =>
  bp === null ? '—' : `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${(Math.abs(bp) / 100).toFixed(1)} %`;

/** Colours follow the line everywhere: yours blue, Nifty 50 aqua, gold yellow (as in the donuts). */
const LINES = [
  { key: 'portfolio', label: 'Your investments', short: 'Yours', color: 'var(--c-cat-1)' },
  { key: 'nifty50', label: 'Nifty 50', short: 'Nifty 50', color: 'var(--c-cat-3)' },
  { key: 'gold', label: 'Gold (GOLDBEES)', short: 'Gold', color: 'var(--c-cat-4)' },
] as const;

/** The portfolio in rupees, or its performance next to Nifty 50 and gold (% since a start). */
export function ValueOverTime({ holdings }: { holdings: Holding[] }) {
  const [view, setView] = useState<'value' | 'compare'>('value');
  const switcher = (
    <div
      role="group"
      aria-label="Value over time view"
      className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm dark:border-slate-700"
    >
      {(
        [
          ['value', 'Value (₹)'],
          ['compare', 'vs Nifty 50 & gold'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => setView(key)}
          className={clsx(
            'rounded-md px-3 py-1',
            view === key
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return view === 'value' ? (
    <ValueView holdings={holdings} switcher={switcher} />
  ) : (
    <CompareView holdings={holdings} switcher={switcher} />
  );
}

function Note({ switcher, text }: { switcher: React.ReactNode; text: string }) {
  return (
    <Card title="Value over time">
      {switcher}
      <p className="text-sm text-slate-500">{text}</p>
    </Card>
  );
}

function ValueView({ holdings, switcher }: { holdings: Holding[]; switcher: React.ReactNode }) {
  const data = useMemo(() => valueHistory(holdings), [holdings]);
  const currency = holdings[0]?.currency ?? 'INR';
  if (data.length < 2) {
    return (
      <Note
        switcher={switcher}
        text={
          oneCurrency(holdings)
            ? 'Each day with prices adds a point: switch on daily NSE prices above, or import your holdings again later, to see the trend.'
            : 'Holdings in different currencies cannot be added up day by day, so there is no chart.'
        }
      />
    );
  }
  const ticks = niceTicks(Math.max(...data.map((d) => d.value)));
  return (
    <ChartCard
      title="Value over time"
      subtitle="On each day a price or trade was recorded"
      controls={switcher}
      table={
        <DataTable
          head={['Date', 'Value']}
          rows={data.map((d) => [dayLabel(d.date), formatMoney(d.value, currency)])}
        />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              minTickGap={24}
            />
            <YAxis
              ticks={ticks}
              domain={[ticks[0]!, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(v: number) => formatCompact(v, currency)}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p ? dayLabel(p.date) : undefined}
                    rows={
                      p
                        ? [{ label: 'Value', value: formatMoney(p.value, currency), color: SINGLE }]
                        : []
                    }
                  />
                );
              }}
            />
            <Line
              dataKey="value"
              type="linear"
              stroke={SINGLE}
              strokeWidth={2}
              dot={
                data.length <= 24 ? { r: 3, fill: SINGLE, stroke: SURFACE, strokeWidth: 2 } : false
              }
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function CompareView({ holdings, switcher }: { holdings: Holding[]; switcher: React.ReactNode }) {
  const me = useMe();
  const on = me.data?.family.livePrices ?? false;
  const bench = useQuery({
    queryKey: ['holdings', 'benchmarks'],
    queryFn: () => api.get<Benchmarks>('/holdings/benchmarks'),
    enabled: on,
  });
  const rows = useMemo(
    () =>
      bench.data ? compareSince(returnIndex(holdings), bench.data.nifty50, bench.data.gold) : [],
    [holdings, bench.data],
  );
  if (!oneCurrency(holdings))
    return (
      <Note
        switcher={switcher}
        text="Holdings in different currencies cannot be compared day by day."
      />
    );
  if (!on)
    return (
      <Note
        switcher={switcher}
        text="Switch on “Daily closing prices from NSE” above: Nifty 50 and gold come with it."
      />
    );
  if (rows.length < 2)
    return (
      <Note
        switcher={switcher}
        text={
          bench.isError
            ? 'Nifty 50 and gold could not be loaded. Try again later.'
            : bench.isPending
              ? 'Loading…'
              : 'The comparison starts once there are two trading days with prices for your holdings, Nifty 50 and gold.'
        }
      />
    );
  const values = rows
    .flatMap((r) => [r.portfolio, r.nifty50, r.gold])
    .filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(0, ...values), Math.min(0, ...values));
  const last = rows.length - 1;
  // Small moves get a decimal, so neighbouring ticks never read the same.
  const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
  return (
    <ChartCard
      title="Value over time"
      subtitle={`Change since ${dayLabel(rows[0]!.date)} — yours without money added or taken out`}
      controls={switcher}
      legend={LINES.map((l) => ({ label: l.label, color: l.color, shape: 'line' as const }))}
      table={
        <DataTable
          head={['Date', ...LINES.map((l) => l.label)]}
          rows={rows.map((r) => [dayLabel(r.date), pct(r.portfolio), pct(r.nifty50), pct(r.gold)])}
        />
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 64, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              minTickGap={24}
            />
            <YAxis
              ticks={ticks}
              domain={[ticks[0]!, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => `${(v / 100).toFixed(step < 100 ? 1 : 0)} %`}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p ? dayLabel(p.date) : undefined}
                    rows={
                      p
                        ? LINES.map((l) => ({
                            label: l.label,
                            value: pct(p[l.key]),
                            color: l.color,
                          }))
                        : []
                    }
                  />
                );
              }}
            />
            {LINES.map((l) => (
              <Line
                key={l.key}
                dataKey={l.key}
                name={l.label}
                type="linear"
                stroke={l.color}
                strokeWidth={2}
                connectNulls
                dot={
                  rows.length <= 24
                    ? { r: 3, fill: l.color, stroke: SURFACE, strokeWidth: 2 }
                    : false
                }
                isAnimationActive={false}
                // Each line is named at its end, so colour is never the only key.
                label={(props: { x?: number | string; y?: number | string; index?: number }) =>
                  props.index === last && props.x !== undefined && props.y !== undefined ? (
                    <text
                      x={Number(props.x) + 8}
                      y={Number(props.y)}
                      dy={4}
                      fontSize={11}
                      fill="var(--c-ink)"
                    >
                      {l.short}
                    </text>
                  ) : (
                    <g />
                  )
                }
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

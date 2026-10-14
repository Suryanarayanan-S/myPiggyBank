import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard, DataTable } from './ChartCard';
import { ChartTooltip } from './ChartTooltip';
import {
  AXIS,
  BUCKET_COLOR,
  GRID,
  SINGLE,
  SURFACE,
  axisTick,
  niceTicks,
  shortMonth,
} from '../../lib/chart';
import type { Dashboard } from '../../lib/dashboardTypes';
import { formatPercent } from '../../lib/percent';
import { useBucketNames } from '../../lib/buckets';
import { BUCKET_KEYS } from '../../lib/types';

const pctTick = (v: number) => `${Math.round(v / 100)} %`;
const bpTicks = (values: (number | null)[]) => {
  const v = values.filter((x): x is number => x !== null);
  return niceTicks(Math.max(0, ...v), Math.min(0, ...v));
};
const dot = (n: number, color: string) =>
  n <= 12 ? { r: 3, fill: color, stroke: SURFACE, strokeWidth: 2 } : false;

export function SavingsRateChart({ d }: { d: Dashboard }) {
  const names = useBucketNames();
  const data = d.months.map((m) => ({
    label: shortMonth(m.month),
    month: m.month,
    rate: m.savingsRateBp,
  }));
  const ticks = bpTicks(data.map((x) => x.rate));
  return (
    <ChartCard
      title="Savings rate"
      subtitle={`(${names.future} + unused) ÷ net income, per month`}
      table={
        <DataTable
          head={['Month', 'Savings rate']}
          rows={d.months.map((m) => [shortMonth(m.month), formatPercent(m.savingsRateBp)])}
        />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              ticks={ticks}
              domain={[ticks[0]!, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={pctTick}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p?.label}
                    rows={
                      p
                        ? [{ label: 'Savings rate', value: formatPercent(p.rate), color: SINGLE }]
                        : []
                    }
                  />
                );
              }}
            />
            <Line
              dataKey="rate"
              type="linear"
              stroke={SINGLE}
              strokeWidth={2}
              dot={dot(data.length, SINGLE)}
              activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function ShareChart({ d }: { d: Dashboard }) {
  const names = useBucketNames();
  const buckets = BUCKET_KEYS;
  const data = d.months.map((m) => ({ label: shortMonth(m.month), ...m.sharesBp }));
  const ticks = bpTicks(
    d.months.flatMap((m) => [m.sharesBp.essentials, m.sharesBp.fun, m.sharesBp.future]),
  );
  return (
    <ChartCard
      title="Share of income"
      subtitle="How each bucket compares with your targets, per month"
      legend={buckets.map((b) => ({
        label: `${names[b]} (target ${d.targets[b]} %)`,
        color: BUCKET_COLOR[b],
        shape: 'line' as const,
      }))}
      table={
        <DataTable
          head={['Month', ...buckets.map((b) => names[b])]}
          rows={d.months.map((m) => [
            shortMonth(m.month),
            ...buckets.map((b) => formatPercent(m.sharesBp[b])),
          ])}
        />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              interval="preserveStartEnd"
              minTickGap={16}
            />
            <YAxis
              ticks={ticks}
              domain={[ticks[0]!, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={pctTick}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p?.label}
                    rows={
                      p
                        ? buckets.map((b) => ({
                            label: names[b],
                            value: formatPercent(p[b]),
                            color: BUCKET_COLOR[b],
                          }))
                        : []
                    }
                  />
                );
              }}
            />
            {buckets.map((b) => (
              <Line
                key={b}
                dataKey={b}
                name={names[b]}
                type="linear"
                stroke={BUCKET_COLOR[b]}
                strokeWidth={2}
                dot={dot(data.length, BUCKET_COLOR[b])}
                activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

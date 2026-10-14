import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
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
  INK,
  MUTED,
  SURFACE,
  axisTick,
  niceTicks,
  shortMonth,
} from '../../lib/chart';
import type { Dashboard } from '../../lib/dashboardTypes';
import { cashFlowRows } from '../../lib/cashflow';
import { formatCompact, formatMoney } from '../../lib/money';
import { useBucketNames } from '../../lib/buckets';

export function CashFlowChart({ d }: { d: Dashboard }) {
  const names = useBucketNames();
  const data = cashFlowRows(d.months);
  const hasUncategorised = data.some((m) => m.uncategorised > 0);
  const money = (c: number) => formatMoney(c, d.currency);
  const ticks = niceTicks(Math.max(0, ...data.map((m) => Math.max(m.netIncome, m.stackTop))));
  return (
    <ChartCard
      title="Income and where it went"
      subtitle={`Per month: ${names.essentials}, ${names.fun} and ${names.future}, with net income as a line`}
      legend={[
        { label: names.essentials, color: BUCKET_COLOR.essentials },
        ...(hasUncategorised ? [{ label: 'Uncategorised', color: MUTED }] : []),
        { label: names.fun, color: BUCKET_COLOR.fun },
        { label: names.future, color: BUCKET_COLOR.future },
        { label: 'Net income', color: INK, shape: 'line' },
      ]}
      table={
        <DataTable
          head={[
            'Month',
            'Net income',
            names.essentials,
            ...(hasUncategorised ? ['Uncategorised'] : []),
            names.fun,
            names.future,
            'Unused',
          ]}
          rows={d.months.map((m) => [
            shortMonth(m.month),
            money(m.netIncome),
            money(m.essentials),
            ...(hasUncategorised ? [money(m.uncategorised)] : []),
            money(m.fun),
            money(m.future),
            money(m.unused),
          ])}
        />
      }
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
              width={64}
              tickFormatter={(v: number) => formatCompact(v, d.currency)}
            />
            <Tooltip
              cursor={{ fill: 'var(--c-grid)', opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={p ? shortMonth(p.month) : undefined}
                    rows={
                      p
                        ? [
                            { label: 'Net income', value: money(p.netIncome), color: INK },
                            {
                              label: names.essentials,
                              value: money(p.essentials),
                              color: BUCKET_COLOR.essentials,
                            },
                            ...(p.uncategorised
                              ? [
                                  {
                                    label: 'Uncategorised',
                                    value: money(p.uncategorised),
                                    color: MUTED,
                                  },
                                ]
                              : []),
                            { label: names.fun, value: money(p.fun), color: BUCKET_COLOR.fun },
                            {
                              label: names.future,
                              value: money(p.future),
                              color: BUCKET_COLOR.future,
                            },
                            { label: 'Unused', value: money(p.unused), color: 'transparent' },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            <Bar
              dataKey="essentials"
              name={names.essentials}
              stackId="s"
              fill={BUCKET_COLOR.essentials}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="uncategorised"
              name="Uncategorised"
              stackId="s"
              fill={MUTED}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="fun"
              name={names.fun}
              stackId="s"
              fill={BUCKET_COLOR.fun}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="future"
              name={names.future}
              stackId="s"
              fill={BUCKET_COLOR.future}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              dataKey="netIncome"
              name="Net income"
              type="linear"
              stroke={INK}
              strokeWidth={2}
              dot={data.length <= 12 ? { r: 3, fill: INK, stroke: SURFACE, strokeWidth: 2 } : false}
              activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

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
  SURFACE,
  axisTick,
  niceTicks,
  shortMonth,
} from '../../lib/chart';
import type { Dashboard } from '../../lib/dashboardTypes';
import { formatCompact, formatMoney } from '../../lib/money';

export function CashFlowChart({ d }: { d: Dashboard }) {
  const data = d.months.map((m) => ({
    ...m,
    label: shortMonth(m.month),
    essentialsAll: m.essentials + m.uncategorised,
  }));
  const money = (c: number) => formatMoney(c, d.currency);
  const ticks = niceTicks(
    Math.max(0, ...data.map((m) => Math.max(m.netIncome, m.essentialsAll + m.fun + m.future))),
  );
  return (
    <ChartCard
      title="Income and where it went"
      subtitle="Per month: Essentials, Fun and Future You, with net income as a line"
      legend={[
        { label: 'Essentials', color: BUCKET_COLOR.essentials },
        { label: 'Fun', color: BUCKET_COLOR.fun },
        { label: 'Future You', color: BUCKET_COLOR.future },
        { label: 'Net income', color: INK, shape: 'line' },
      ]}
      table={
        <DataTable
          head={['Month', 'Net income', 'Essentials', 'Fun', 'Future You', 'Unused']}
          rows={d.months.map((m) => [
            shortMonth(m.month),
            money(m.netIncome),
            money(m.essentials + m.uncategorised),
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
                              label: 'Essentials',
                              value: money(p.essentialsAll),
                              color: BUCKET_COLOR.essentials,
                            },
                            { label: 'Fun', value: money(p.fun), color: BUCKET_COLOR.fun },
                            {
                              label: 'Future You',
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
              dataKey="essentialsAll"
              name="Essentials"
              stackId="s"
              fill={BUCKET_COLOR.essentials}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="fun"
              name="Fun"
              stackId="s"
              fill={BUCKET_COLOR.fun}
              stroke={SURFACE}
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
            <Bar
              dataKey="future"
              name="Future You"
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

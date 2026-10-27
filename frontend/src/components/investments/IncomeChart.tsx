import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { AXIS, GRID, SURFACE, axisTick, niceTicks } from '../../lib/chart';
import { formatCompact, formatMoney } from '../../lib/money';
import { payoutBars, type Payout } from '../../lib/payouts';

/** Colours follow the entity, as in Console: dividends blue, interest orange. */
const SERIES = [
  { key: 'dividend', label: 'Dividend', color: 'var(--c-cat-1)' },
  { key: 'interest', label: 'Interest', color: 'var(--c-cat-2)' },
] as const;

const STEP_WORD = { month: 'by month', quarter: 'by quarter', year: 'by financial year' } as const;

/**
 * The payouts the table shows (same type, period, search and demats; sold holdings included),
 * stacked per month, quarter or financial year as the period's length suits.
 */
export function IncomeChart({
  payouts,
  from,
  to,
}: {
  payouts: Payout[];
  /** the period's first and last day; no first day: from the first payout */
  from: string | null;
  to: string;
}) {
  const r = payoutBars(payouts, from, to);
  if (!r) return null;
  const currency = r.currency;
  const money = (c: number) => formatMoney(c, currency);
  const rows = r.bars.map((q) => ({ ...q, total: q.dividend + q.interest }));
  const ticks = niceTicks(Math.max(...rows.map((q) => q.total)));
  const shown = SERIES.filter((s) => rows.some((q) => q[s.key] > 0));
  return (
    <ChartCard
      title="Dividend and interest"
      subtitle={`${money(r.total)} from ${r.count} ${r.count === 1 ? 'payout' : 'payouts'}, ${STEP_WORD[r.step]}${r.others.length ? ` (${currency} only; ${r.others.join(', ')} in the table)` : ''}`}
      legend={shown.map((s) => ({ label: s.label, color: s.color }))}
      table={
        <DataTable
          head={[
            { month: 'Month', quarter: 'Quarter', year: 'Financial year' }[r.step],
            ...shown.map((s) => s.label),
            'Total',
          ]}
          rows={rows.map((q) => [q.label, ...shown.map((s) => money(q[s.key])), money(q.total)])}
        />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              // a year by month: every label where they fit, else some
              interval={rows.length > 8 ? 'preserveStartEnd' : 0}
              minTickGap={4}
            />
            <YAxis
              ticks={ticks}
              domain={[0, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => formatCompact(v, currency)}
            />
            <Tooltip
              cursor={{ fill: 'var(--c-grid)', opacity: 0.4 }}
              content={({ active, payload }) => {
                const q = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={q?.label}
                    rows={
                      q
                        ? [
                            ...shown.map((s) => ({
                              label: s.label,
                              value: money(q[s.key]),
                              color: s.color,
                            })),
                            { label: 'Total', value: money(q.total), color: 'transparent' },
                          ]
                        : []
                    }
                  />
                );
              }}
            />
            {shown.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="income"
                fill={s.color}
                stroke={SURFACE}
                strokeWidth={1}
                maxBarSize={32}
                radius={i === shown.length - 1 ? [4, 4, 0, 0] : undefined}
                isAnimationActive={false}
              >
                {/* each bar's total, written once above it (when there is room) */}
                {i === shown.length - 1 && rows.length <= 8 && (
                  <LabelList
                    dataKey="total"
                    position="top"
                    fontSize={11}
                    fill="var(--c-ink)"
                    formatter={(v: unknown) => (Number(v) > 0 ? money(Number(v)) : '')}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

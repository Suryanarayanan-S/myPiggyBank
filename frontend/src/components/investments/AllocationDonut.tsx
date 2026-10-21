import { useState } from 'react';
import clsx from 'clsx';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { SURFACE } from '../../lib/chart';
import type { Holding } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import {
  allGroups,
  allocation,
  sliceColors,
  type Grouping,
  type Measure,
} from '../../lib/portfolio';

const MEASURES: [Measure, string][] = [
  ['value', 'Worth now'],
  ['cost', 'Put in'],
];

/**
 * Part of the portfolio at a glance: at most five slices, each named with its share — of what
 * it is worth now, or of the money put in (switch under the donut).
 */
export function AllocationDonut({
  holdings,
  grouping,
  currency,
  subtitle,
}: {
  holdings: Holding[];
  grouping: Grouping;
  currency: string;
  subtitle?: string;
}) {
  const [measure, setMeasure] = useState<Measure>('value');
  const slices = allocation(holdings, grouping, 4, measure);
  const everyGroup = allGroups(holdings, grouping);
  const putIn = new Map(allGroups(holdings, grouping, 'cost').map((g) => [g.label, g]));
  const colors = sliceColors(grouping, slices);
  const colorOf = (label: string) =>
    colors[slices.findIndex((s) => s.label === label)] ?? 'var(--c-rest)';
  if (slices.length === 0) return null;
  return (
    <ChartCard
      title={grouping.title}
      subtitle={subtitle}
      table={
        <DataTable
          head={['Group', 'Worth now', 'Share', 'Put in', 'Share']}
          rows={everyGroup.map((g) => [
            g.label,
            formatMoney(g.value, currency),
            formatPercent(g.shareBp),
            formatMoney(putIn.get(g.label)?.value ?? 0, currency),
            formatPercent(putIn.get(g.label)?.shareBp ?? 0),
          ])}
        />
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative h-40 w-40 shrink-0"
          role="img"
          aria-label={`${grouping.title}, ${measure === 'value' ? 'worth now' : 'money put in'}: ${slices.map((s) => `${s.label} ${formatPercent(s.shareBp)}`).join(', ')}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke={SURFACE}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.label} fill={colorOf(s.label)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  // Recharts passes a copy of the slice: find it by its label.
                  const p = payload?.[0]?.payload as (typeof slices)[number] | undefined;
                  return (
                    <ChartTooltip
                      active={active}
                      title={p?.label}
                      rows={
                        p
                          ? [
                              {
                                label: formatPercent(p.shareBp),
                                value: formatMoney(p.value, currency),
                                color: colorOf(p.label),
                              },
                            ]
                          : []
                      }
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full min-w-0 space-y-1.5 text-sm">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: colorOf(s.label) }}
                />
                <span className="truncate" title={s.label}>
                  {s.label}
                </span>
              </span>
              <span className="shrink-0 text-slate-600 tabular-nums dark:text-slate-300">
                {formatPercent(s.shareBp)}
              </span>
            </li>
          ))}
        </ul>
        <div
          role="group"
          aria-label={`${grouping.title}: share of`}
          className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700"
        >
          {MEASURES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={measure === key}
              onClick={() => setMeasure(key)}
              className={clsx(
                'rounded-md px-2.5 py-1',
                measure === key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

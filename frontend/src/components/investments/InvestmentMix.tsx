import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '../ui/Card';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { Sparkline } from '../dashboard/Sparkline';
import { SURFACE } from '../../lib/chart';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';

export type MixRow = {
  key: string;
  label: string;
  /** the full name, on hover */
  title?: string;
  /** worth today, in `currency` */
  value: number;
  color: string;
  /** the page it opens */
  to: string;
  hint?: string;
  /** how it moved over the chosen range */
  line?: number[];
};

/**
 * What everything invested is made of: a donut of the shares and, for each kind, its amount,
 * share and how it moved — each row opens that kind's page. The total itself is on the chart
 * beside it, so it is not repeated here.
 */
export function InvestmentMix({
  rows,
  currency,
  className,
}: {
  rows: MixRow[];
  currency: string;
  className?: string;
}) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const share = (v: number) => (total > 0 ? Math.round((Math.max(0, v) * 10_000) / total) : 0);
  const slices = rows.filter((r) => r.value > 0);
  return (
    <Card title="By type" className={className}>
      {slices.length > 0 && (
        <div
          className="relative mx-auto h-40 w-40"
          role="img"
          aria-label={`Share of each type: ${slices.map((s) => `${s.label} ${formatPercent(share(s.value))}`).join(', ')}`}
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
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as MixRow | undefined;
                  return (
                    <ChartTooltip
                      active={active && !!p}
                      title={p?.label}
                      rows={
                        p
                          ? [
                              {
                                label: formatPercent(share(p.value)),
                                value: formatMoney(p.value, currency),
                                color: p.color,
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
          <p className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-semibold tabular-nums">{slices.length}</span>
            <span className="text-xs text-slate-500">{slices.length === 1 ? 'type' : 'types'}</span>
          </p>
        </div>
      )}
      <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              to={r.to}
              className="group -mx-2 grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ background: r.color }}
                />
                <span className="min-w-0">
                  <span className="block" title={r.title}>
                    {r.label}
                  </span>
                  {r.hint && <span className="block text-xs text-slate-500">{r.hint}</span>}
                </span>
              </span>
              <span className="min-w-0">{r.line && <Sparkline values={r.line} height={28} />}</span>
              <span className="flex items-center gap-1 text-right text-sm">
                <span>
                  <span className="block tabular-nums">{formatMoney(r.value, currency)}</span>
                  {total > 0 && (
                    <span className="block text-xs text-slate-500 tabular-nums">
                      {formatPercent(share(r.value))}
                    </span>
                  )}
                </span>
                <ChevronRight
                  size={16}
                  aria-hidden
                  className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

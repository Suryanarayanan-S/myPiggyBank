import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard, DataTable } from './ChartCard';
import { ChartTooltip } from './ChartTooltip';
import { BUCKET_COLOR, MUTED, SINGLE, axisTick } from '../../lib/chart';
import type { Dashboard } from '../../lib/dashboardTypes';
import { formatCompact, formatMoney } from '../../lib/money';
import { BUCKETS, type Bucket } from '../../lib/types';

type Row = { name: string; actual: number; color: string };
const TOP = 8;

function Bars({ rows, currency, label }: { rows: Row[]; currency: string; label: string }) {
  return (
    <div style={{ height: Math.max(80, rows.length * 32 + 16) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={128}
            tick={axisTick}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'var(--c-grid)', opacity: 0.5 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Row | undefined;
              return (
                <ChartTooltip
                  active={active}
                  title={p?.name}
                  rows={
                    p ? [{ label, value: formatMoney(p.actual, currency), color: p.color }] : []
                  }
                />
              );
            }}
          />
          <Bar
            dataKey="actual"
            barSize={16}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
            label={{
              position: 'right',
              fill: MUTED,
              fontSize: 12,
              formatter: (v: unknown) => formatCompact(Number(v), currency),
            }}
          >
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBars({ d }: { d: Dashboard }) {
  const top = d.categories.slice(0, TOP);
  const rest = d.categories.slice(TOP).reduce((s, c) => s + c.actual, 0);
  const rows: Row[] = [
    ...top.map((c) => ({
      name: c.name,
      actual: c.actual,
      color: c.bucket ? BUCKET_COLOR[c.bucket] : MUTED,
    })),
    ...(rest > 0
      ? [{ name: `${d.categories.length - TOP} more`, actual: rest, color: MUTED }]
      : []),
  ];
  const present = (Object.keys(BUCKETS) as Bucket[]).filter((b) => top.some((c) => c.bucket === b));
  return (
    <ChartCard
      title="Where the money went"
      subtitle="Largest categories in this period"
      legend={present.map((b) => ({ label: BUCKETS[b], color: BUCKET_COLOR[b] }))}
      table={
        <DataTable
          head={['Category', 'Bucket', 'Amount']}
          rows={d.categories.map((c) => [
            c.name,
            c.bucket ? BUCKETS[c.bucket] : '—',
            formatMoney(c.actual, d.currency),
          ])}
        />
      }
    >
      {rows.length ? (
        <Bars rows={rows} currency={d.currency} label="Spent" />
      ) : (
        <p className="text-sm text-slate-500">No expenses in this period.</p>
      )}
    </ChartCard>
  );
}

export function MemberBars({ d }: { d: Dashboard }) {
  const rows: Row[] = d.members.map((m) => ({ name: m.name, actual: m.actual, color: SINGLE }));
  return (
    <ChartCard
      title="Spending by family member"
      subtitle="Essentials + Fun; Future You is saving, not spending"
      table={
        <DataTable
          head={['Member', 'Spent']}
          rows={d.members.map((m) => [m.name, formatMoney(m.actual, d.currency)])}
        />
      }
    >
      {rows.length ? (
        <Bars rows={rows} currency={d.currency} label="Spent" />
      ) : (
        <p className="text-sm text-slate-500">No spending in this period.</p>
      )}
    </ChartCard>
  );
}

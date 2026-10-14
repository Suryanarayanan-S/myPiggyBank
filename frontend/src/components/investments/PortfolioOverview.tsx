import { useMemo } from 'react';
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
import { Card } from '../ui/Card';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { AXIS, GRID, SINGLE, SURFACE, axisTick, niceTicks } from '../../lib/chart';
import { gainClass, signed, type Holding } from '../../lib/investments';
import { formatCompact, formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { movers, oneCurrency, ranked, valueHistory } from '../../lib/portfolio';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

/** A Console-style overview: what weighs most, what moved most, and the value over time. */
export function PortfolioOverview({
  holdings,
  currency,
  onOpen,
}: {
  holdings: Holding[];
  currency: string;
  onOpen: (id: string) => void;
}) {
  const top = ranked(holdings, currency).slice(0, 10);
  const { gainers, losers } = movers(holdings, 5);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Biggest holdings">
          {top.length === 0 && (
            <p className="text-sm text-slate-500">
              Nothing to compare yet in {currency} (add an exchange rate or a trade).
            </p>
          )}
          <ol className="space-y-2.5 empty:hidden">
            {top.map((r) => (
              <li key={r.holding.id}>
                <div className="mb-1 flex justify-between gap-3 text-sm">
                  <button
                    type="button"
                    className="min-w-0 truncate text-left hover:underline"
                    onClick={() => onOpen(r.holding.id)}
                  >
                    {r.holding.name}
                  </button>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(r.value, currency)}{' '}
                    <span className="text-slate-500">{formatPercent(r.weightBp)}</span>
                  </span>
                </div>
                <div aria-hidden className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(top[0]!.weightBp ?? 0) > 0 ? ((r.weightBp ?? 0) / top[0]!.weightBp!) * 100 : 0}%`,
                      background: 'var(--c-single)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Movers title="Top gainers" list={gainers} onOpen={onOpen} />
          <Movers title="Top losers" list={losers} onOpen={onOpen} />
        </div>
      </div>
      <ValueChart holdings={holdings} />
    </div>
  );
}

function Movers({
  title,
  list,
  onOpen,
}: {
  title: string;
  list: Holding[];
  onOpen: (id: string) => void;
}) {
  return (
    <Card title={title}>
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">None</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {list.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                className="min-w-0 truncate text-left hover:underline"
                onClick={() => onOpen(h.id)}
              >
                {h.name}
              </button>
              <span className={clsx('shrink-0 text-right tabular-nums', gainClass(h.returnBp))}>
                {formatPercent(h.returnBp)}
                <span className="block text-xs">
                  {h.unrealised === null ? '' : signed(h.unrealised, h.currency)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ValueChart({ holdings }: { holdings: Holding[] }) {
  const data = useMemo(() => valueHistory(holdings), [holdings]);
  const currency = holdings[0]?.currency ?? 'INR';
  if (data.length < 2) {
    return (
      <Card title="Value over time">
        <p className="text-sm text-slate-500">
          {oneCurrency(holdings)
            ? 'Each import or price you enter adds a point. Download your holdings from Kite again next month and import them to see the trend.'
            : 'Holdings in different currencies cannot be added up day by day, so there is no chart.'}
        </p>
      </Card>
    );
  }
  const ticks = niceTicks(Math.max(...data.map((d) => d.value)));
  return (
    <ChartCard
      title="Value over time"
      subtitle="On each day a price or trade was recorded"
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

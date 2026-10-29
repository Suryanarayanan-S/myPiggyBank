import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard, DataTable } from '../components/dashboard/ChartCard';
import { ChartTooltip } from '../components/dashboard/ChartTooltip';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import { AXIS, GRID, MUTED, axisTick, niceTicks } from '../lib/chart';
import {
  PAIRS,
  RANGES,
  bandTicks,
  formatRate,
  inRange,
  indexed,
  pairRate,
  since,
  type CurrencyAnalytics,
  type FxPoint,
  type FxTransfer,
  type Pair,
} from '../lib/fx';
import { formatMoney } from '../lib/money';
import { useRemembered } from '../lib/remember';

const dayLabel = (d: string, year = true) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year && { year: 'numeric' }),
    timeZone: 'UTC',
  });
const pct = (v: number, places = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(places)} %`;
const RANGE_KEYS = RANGES.map((r) => r.key);
const VIEWS = ['compare', ...PAIRS.map((p) => p.key)] as const;
type View = (typeof VIEWS)[number];

/** A row of buttons of which one is chosen (like the period filter). */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={clsx(
            'rounded-md px-2.5 py-1 text-sm',
            value === o.key
              ? 'bg-white font-medium shadow-sm dark:bg-slate-900'
              : 'text-slate-600 dark:text-slate-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A move of a rate. Neutral ink: whether a stronger euro is good depends on which way the money
 * goes, so there is no green or red here.
 */
function Move({ label, change }: { label: string; change: ReturnType<typeof since> }) {
  if (!change) return null;
  const Icon = change.pct >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex items-center gap-1 text-xs text-slate-600 tabular-nums dark:text-slate-300">
      <Icon size={14} className="shrink-0 text-slate-400" aria-hidden />
      <span className="font-medium">{pct(change.pct)}</span>
      <span className="text-slate-500">{label}</span>
    </p>
  );
}

function PairTile({ pair, series }: { pair: Pair; series: FxPoint[] }) {
  const last = series.at(-1)!;
  return (
    <Card className="!p-4">
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: pair.color }} />
        {pair.name}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        <span className="mr-1 text-base font-normal text-slate-500">
          1 {pair.from === 'EUR' ? '€' : '$'} =
        </span>
        {formatRate(pairRate(last, pair), pair.to)}
      </p>
      <div className="mt-1 space-y-0.5">
        <Move label="since the day before" change={since(series, pair, 'day')} />
        <Move label="in a month" change={since(series, pair, 'month')} />
        <Move label="in a year" change={since(series, pair, 'year')} />
      </div>
    </Card>
  );
}

function RatesChart({ series }: { series: FxPoint[] }) {
  const [range, setRange] = useRemembered('pb-fx-range', RANGE_KEYS, '1Y');
  const [view, setView] = useRemembered<View>('pb-fx-view', VIEWS, 'compare');
  const points = inRange(series, range);
  const pair = PAIRS.find((p) => p.key === view);
  const compare = !pair;
  const rows = compare
    ? indexed(points)
    : points.map((p) => ({ date: p.date, [pair.key]: pairRate(p, pair) }));
  const lines = compare ? PAIRS : [pair];
  const values = rows.flatMap((r) => lines.map((l) => (r as Record<string, number>)[l.key]!));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // % change: from a round number below the lowest; a rate: around its own band
  const ticks = compare ? niceTicks(hi, Math.min(0, lo)) : bandTicks(lo, hi);
  const show = (key: Pair['key'], v: number) =>
    compare ? pct(v) : formatRate(v, PAIRS.find((p) => p.key === key)!.to);
  const longRange =
    points.length > 0 &&
    Date.parse(points.at(-1)!.date) - Date.parse(points[0]!.date) > 400 * 86_400_000;
  return (
    <ChartCard
      title={compare ? 'How the three moved' : pair.name}
      subtitle={
        compare
          ? `Change of each rate since ${dayLabel(points[0]!.date)}: on one scale, so their moves compare directly`
          : `1 ${pair.from === 'EUR' ? '€' : '$'} in ${pair.to === 'INR' ? 'rupees' : 'dollars'}, ECB reference rate`
      }
      controls={
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Range"
            value={range}
            options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
            onChange={setRange}
          />
          <Segmented
            label="Show"
            value={view}
            options={[
              { key: 'compare' as View, label: 'Compare %' },
              ...PAIRS.map((p) => ({ key: p.key as View, label: p.label })),
            ]}
            onChange={setView}
          />
        </div>
      }
      legend={lines.map((l) => ({ label: l.label, color: l.color, shape: 'line' as const }))}
      table={
        <DataTable
          head={['Date', ...lines.map((l) => l.label)]}
          rows={[...points].reverse().map((p) => [
            dayLabel(p.date),
            ...lines.map((l) => {
              const rate = formatRate(pairRate(p, l), l.to);
              return compare
                ? `${rate} (${pct((pairRate(p, l) / pairRate(points[0]!, l) - 1) * 100)})`
                : rate;
            }),
          ])}
        />
      }
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => dayLabel(d, longRange)}
              tick={axisTick}
              tickLine={false}
              axisLine={{ stroke: AXIS }}
              minTickGap={32}
            />
            <YAxis
              ticks={ticks}
              domain={[ticks[0]!, ticks.at(-1)!]}
              tick={axisTick}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v: number) =>
                compare ? `${v.toFixed(Math.abs(hi - lo) < 4 ? 1 : 0)} %` : show(pair.key, v)
              }
            />
            {compare && <ReferenceLine y={0} stroke={MUTED} strokeDasharray="3 3" />}
            <Tooltip
              cursor={{ stroke: AXIS }}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as { date: string } | undefined;
                const p = r && points.find((x) => x.date === r.date);
                return (
                  <ChartTooltip
                    active={active}
                    title={r ? dayLabel(r.date) : undefined}
                    rows={
                      p
                        ? lines.map((l) => ({
                            label: l.label,
                            value: compare
                              ? `${formatRate(pairRate(p, l), l.to)} · ${pct((pairRate(p, l) / pairRate(points[0]!, l) - 1) * 100)}`
                              : formatRate(pairRate(p, l), l.to),
                            color: l.color,
                          }))
                        : []
                    }
                  />
                );
              }}
            />
            {lines.map((l) => (
              <Line
                key={l.key}
                dataKey={l.key}
                name={l.label}
                type="linear"
                stroke={l.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function Transfers({ transfers, uncompared }: { transfers: FxTransfer[]; uncompared: number }) {
  const older =
    uncompared > 0 ? (
      <p className="mt-3 text-xs text-slate-500">
        {uncompared} older {uncompared === 1 ? 'transfer is' : 'transfers are'} from before 2020,
        where the rates kept here start, and {uncompared === 1 ? 'is' : 'are'} not compared.
      </p>
    ) : null;
  if (transfers.length === 0)
    return (
      <Card title="Your transfers against the market">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No transfers between euro, dollar and rupee accounts yet. Record one as a transfer between
          two of your{' '}
          <Link to="/wealth/accounts" className="text-indigo-600 underline">
            accounts
          </Link>{' '}
          with both amounts (what left and what arrived), and it is compared with the ECB rate of
          its day here.
        </p>
        {older}
      </Card>
    );
  // what the rates cost (−) or gained (+), per currency received
  const totals = new Map<string, number>();
  for (const t of transfers) totals.set(t.to, (totals.get(t.to) ?? 0) + t.diff);
  return (
    <Card title="Your transfers against the market">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
        Compared with the ECB reference rate of each day, your {transfers.length}{' '}
        {transfers.length === 1 ? 'transfer' : 'transfers'} brought{' '}
        {[...totals]
          .map(([c, v]) =>
            v === 0
              ? `the same ${c} as at that rate`
              : `${formatMoney(Math.abs(v), c)} ${v < 0 ? 'less' : 'more'}`,
          )
          .join(' and ')}
        . Banks and money services add a margin to that rate, so a little less is normal.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Transfers between currencies and the ECB rate</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
              <th scope="col" className="py-2 pr-3 font-medium">
                Date
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                From → to
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Sent
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Received
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Your rate
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                ECB rate
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Difference
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
            {transfers.map((t) => {
              // with rupees: ₹ per € or $, to the paisa; euro and dollar: $ per €, four places
              const rupees = t.from === 'INR' || t.to === 'INR';
              const quote = (v: number) => (rupees ? `₹${v.toFixed(2)}` : `$${v.toFixed(4)}`);
              return (
                <tr key={t.id}>
                  <td className="py-2 pr-3 whitespace-nowrap">{dayLabel(t.date)}</td>
                  <td className="py-2 pr-3">
                    {t.fromAccount} → {t.toAccount}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatMoney(t.sent, t.from)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(t.received, t.to)}</td>
                  <td className="py-2 pr-3 text-right">{quote(t.yourRate)}</td>
                  <td
                    className="py-2 pr-3 text-right"
                    title={
                      t.marketDate !== t.date ? `ECB rate of ${dayLabel(t.marketDate)}` : undefined
                    }
                  >
                    {quote(t.marketRate)}
                  </td>
                  <td
                    className={clsx(
                      'py-2 text-right font-medium',
                      t.diff < 0
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    {t.diff < 0 ? '−' : '+'}
                    {formatMoney(Math.abs(t.diff), t.to)}
                    <span className="block text-xs font-normal text-slate-500">
                      {pct(t.diffPct)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {older}
    </Card>
  );
}

/**
 * Analytics → Currencies: how the euro, the dollar and the rupee move against each other (the
 * ECB's daily reference rates, fresh when the page opens), and the family's own transfers against
 * the market rate of their day.
 */
export function CurrenciesPage() {
  const q = useQuery({
    queryKey: ['analytics', 'currencies'],
    queryFn: () => api.get<CurrencyAnalytics>('/analytics/currencies'),
    // the server asks the ECB at most hourly; the page can look again every quarter hour
    refetchInterval: 15 * 60_000,
  });
  const d = q.data;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Currencies</h1>
        <p className="text-sm text-slate-500">
          Euro, dollar and rupee: ECB reference rates
          {d?.asOf ? `, latest of ${dayLabel(d.asOf)}` : ''}. The ECB publishes once a working day
          around 16:00 CET; this page checks for a new rate when it opens (at most hourly).
        </p>
      </div>
      <FormError error={q.error} />
      {d?.refreshError && (
        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {d.refreshError}
        </p>
      )}
      {d && d.series.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No exchange rates yet: they are fetched from the ECB when this page opens and the server
            can go online.
          </p>
        </Card>
      )}
      {d && d.series.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {PAIRS.map((p) => (
              <PairTile key={p.key} pair={p} series={d.series} />
            ))}
          </div>
          <RatesChart series={d.series} />
        </>
      )}
      {d && <Transfers transfers={d.transfers} uncompared={d.uncompared} />}
    </div>
  );
}

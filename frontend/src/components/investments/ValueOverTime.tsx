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
type Benchmarks = Record<SeriesKey, Point[]>;

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
type SeriesKey = 'nifty50' | 'gold22k' | 'gold24k' | 'gold' | 'goldUsd';
const inr = (v: number, digits = 0) =>
  `₹${v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
/**
 * What can be compared. Colours follow the entity: Nifty 50 aqua; gold yellow — Indian gold
 * solid, world gold dashed (so the two never rely on colour alone). Yours is always blue.
 */
const SERIES: Record<
  SeriesKey,
  { label: string; short: string; color: string; dash?: string; price: (v: number) => string }
> = {
  nifty50: {
    label: 'Nifty 50',
    short: 'Nifty 50',
    color: 'var(--c-cat-3)',
    price: (v) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 }),
  },
  gold22k: {
    label: 'Gold 22K (IBJA)',
    short: '22K gold',
    color: 'var(--c-cat-4)',
    price: (v) => `${inr(v)}/g`,
  },
  gold24k: {
    label: 'Gold 24K (IBJA)',
    short: '24K gold',
    color: 'var(--c-cat-4)',
    price: (v) => `${inr(v)}/g`,
  },
  gold: {
    label: 'Gold (GOLDBEES)',
    short: 'GOLDBEES',
    color: 'var(--c-cat-4)',
    price: (v) => inr(v, 2),
  },
  goldUsd: {
    label: 'Gold, world ($/oz)',
    short: 'Gold $',
    color: 'var(--c-cat-4)',
    dash: '6 4',
    price: (v) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}/oz`,
  },
};
const YOURS = { label: 'Your investments', short: 'Yours', color: 'var(--c-cat-1)' };

/** Which lines are shown: Nifty 50, one Indian gold, world gold (remembered on this browser). */
type GoldIndia = 'gold22k' | 'gold24k' | 'gold';
type Choice = { nifty50: boolean; goldIndiaOn: boolean; goldIndia: GoldIndia; goldUsd: boolean };
const CHOICE_KEY = 'pb-compare';
const DEFAULT_CHOICE: Choice = {
  nifty50: true,
  goldIndiaOn: true,
  goldIndia: 'gold22k',
  goldUsd: false,
};
function readChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null;
    if (!c) return DEFAULT_CHOICE;
    return {
      nifty50: c.nifty50 !== false,
      goldIndiaOn: c.goldIndiaOn !== false,
      goldIndia: ['gold22k', 'gold24k', 'gold'].includes(c.goldIndia as string)
        ? (c.goldIndia as GoldIndia)
        : 'gold22k',
      goldUsd: c.goldUsd === true,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}
const chosen = (c: Choice): SeriesKey[] => [
  ...(c.nifty50 ? (['nifty50'] as const) : []),
  ...(c.goldIndiaOn ? [c.goldIndia] : []),
  ...(c.goldUsd ? (['goldUsd'] as const) : []),
];

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

function Picker({ choice, onChange }: { choice: Choice; onChange: (c: Choice) => void }) {
  return (
    <fieldset className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <legend className="sr-only">Compare with</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={choice.nifty50}
          onChange={(e) => onChange({ ...choice, nifty50: e.target.checked })}
        />
        Nifty 50
      </label>
      <span className="flex items-center gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={choice.goldIndiaOn}
            onChange={(e) => onChange({ ...choice, goldIndiaOn: e.target.checked })}
          />
          Gold in India
        </label>
        <select
          aria-label="Which gold in India"
          className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={choice.goldIndia}
          // choosing a gold also ticks it
          onChange={(e) =>
            onChange({ ...choice, goldIndiaOn: true, goldIndia: e.target.value as GoldIndia })
          }
        >
          <option value="gold22k">22K per gram (IBJA)</option>
          <option value="gold24k">24K per gram (IBJA)</option>
          <option value="gold">GOLDBEES ETF</option>
        </select>
      </span>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={choice.goldUsd}
          onChange={(e) => onChange({ ...choice, goldUsd: e.target.checked })}
        />
        Gold, world price ($ per ounce)
        <span className="text-xs text-slate-500">— collected daily from 21 Oct 2026</span>
      </label>
    </fieldset>
  );
}

function CompareView({ holdings, switcher }: { holdings: Holding[]; switcher: React.ReactNode }) {
  const me = useMe();
  const on = me.data?.family.livePrices ?? false;
  const [choice, setChoice] = useState<Choice>(readChoice);
  const choose = (c: Choice) => {
    setChoice(c);
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
    } catch {
      // storage refused: the choice still applies for this visit
    }
  };
  const bench = useQuery({
    queryKey: ['holdings', 'benchmarks'],
    queryFn: () => api.get<Benchmarks>('/holdings/benchmarks'),
    enabled: on,
  });
  const keys = useMemo(() => chosen(choice), [choice]);
  const rows = useMemo(
    () =>
      bench.data
        ? compareSince(
            returnIndex(holdings),
            Object.fromEntries(keys.map((k) => [k, bench.data[k] ?? []])),
          )
        : [],
    [holdings, bench.data, keys],
  );
  const controls = (
    <>
      {switcher}
      {on && <Picker choice={choice} onChange={choose} />}
    </>
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
        switcher={controls}
        text="Switch on “Daily closing prices from NSE” above: Nifty 50 and the gold prices come with it."
      />
    );
  if (rows.length < 2) {
    const empty = keys
      .filter((k) => (bench.data?.[k] ?? []).length === 0)
      .map((k) => SERIES[k].label);
    return (
      <Note
        switcher={controls}
        text={
          bench.isError
            ? 'Market prices could not be loaded. Try again later.'
            : bench.isPending
              ? 'Loading…'
              : empty.length
                ? `No prices yet for ${empty.join(', ')}: they are collected each day from now on.`
                : 'The comparison starts once all ticked lines have two days in common — untick one to start earlier.'
        }
      />
    );
  }
  const lines = [
    { key: 'portfolio', ...YOURS, dash: undefined as string | undefined },
    ...keys.map((k) => ({ key: k as string, ...SERIES[k] })),
  ];
  const values = rows
    .flatMap((r) => Object.values(r.change))
    .filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(0, ...values), Math.min(0, ...values));
  // Small moves get a decimal, so neighbouring ticks never read the same.
  const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
  // Each line is named at its own last point (a later day may have only some of the lines).
  const lastOf: Record<string, number> = Object.fromEntries(
    ['portfolio', ...keys].map((k) => [
      k,
      rows.reduce((at, x, i) => (x.change[k] != null ? i : at), -1),
    ]),
  );
  const data = rows.map((r) => ({ date: r.date, ...r.change }));
  const cell = (r: (typeof rows)[number], k: string) => {
    const change = pct(r.change[k] ?? null);
    const price = k === 'portfolio' ? null : r.price[k];
    return price == null ? change : `${SERIES[k as SeriesKey].price(price)} (${change})`;
  };
  return (
    <ChartCard
      title="Value over time"
      subtitle={`Change since ${dayLabel(rows[0]!.date)} — yours without money added or taken out`}
      controls={controls}
      legend={lines.map((l) => ({
        label: l.label,
        color: l.color,
        shape: l.dash ? ('dash' as const) : ('line' as const),
      }))}
      table={
        <DataTable
          head={['Date', ...lines.map((l) => l.label)]}
          rows={rows.map((r) => [dayLabel(r.date), ...lines.map((l) => cell(r, l.key))])}
        />
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 72, bottom: 0, left: 0 }}>
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
                const p = payload?.[0]?.payload as { date: string } | undefined;
                const r = p ? rows.find((x) => x.date === p.date) : undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={r ? dayLabel(r.date) : undefined}
                    rows={
                      r
                        ? lines.map((l) => ({
                            label: l.label,
                            value: cell(r, l.key),
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
                strokeDasharray={l.dash}
                connectNulls
                dot={
                  rows.length <= 24
                    ? { r: 3, fill: l.color, stroke: SURFACE, strokeWidth: 2 }
                    : false
                }
                isAnimationActive={false}
                // Each line is named at its end, so colour is never the only key.
                label={(props: { x?: number | string; y?: number | string; index?: number }) =>
                  props.index === lastOf[l.key] &&
                  props.x !== undefined &&
                  props.y !== undefined ? (
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

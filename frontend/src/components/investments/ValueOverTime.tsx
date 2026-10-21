import { useCallback, useMemo, useState } from 'react';
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
import { useMe } from '../../auth/auth';
import { Card } from '../ui/Card';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import {
  AXIS,
  GRID,
  SURFACE,
  axisTick,
  nearGroups,
  niceTicks,
  spreadLabels,
} from '../../lib/chart';
import { api } from '../../lib/api';
import type { Holding } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { compareSince, oneCurrency, returnIndex, valueHistory } from '../../lib/portfolio';

type Point = { date: string; value: number };
type MarketKey = 'nifty50' | 'gold22k' | 'gold24k' | 'gold' | 'goldUsd';
type LineKey = 'portfolio' | MarketKey;
type Benchmarks = Record<MarketKey, Point[]>;

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const pct = (bp: number | null) =>
  bp === null ? '—' : `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${(Math.abs(bp) / 100).toFixed(1)} %`;
const inr = (v: number, digits = 0) =>
  `₹${v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;

/**
 * Every line that can be ticked. Colours follow the entity: yours blue, Nifty 50 aqua, gold
 * yellow (as in the donuts), GOLDBEES orange. The yellow golds differ by stroke — 22K solid,
 * 24K dotted, world dashed — so they never rely on colour alone.
 */
const LINES: Record<
  LineKey,
  {
    label: string;
    tick: string;
    short: string;
    color: string;
    dash?: string;
    shape?: 'dash' | 'dot';
  }
> = {
  portfolio: {
    label: 'Your investments',
    tick: 'Your investments',
    short: 'Yours',
    color: 'var(--c-cat-1)',
  },
  nifty50: { label: 'Nifty 50', tick: 'Nifty 50', short: 'Nifty 50', color: 'var(--c-cat-3)' },
  gold22k: {
    label: 'Gold 22K (IBJA)',
    tick: 'Gold 22K per gram',
    short: '22K gold',
    color: 'var(--c-cat-4)',
  },
  gold24k: {
    label: 'Gold 24K (IBJA)',
    tick: 'Gold 24K per gram',
    short: '24K gold',
    color: 'var(--c-cat-4)',
    dash: '2 3',
    shape: 'dot',
  },
  gold: {
    label: 'GOLDBEES ETF',
    tick: 'GOLDBEES ETF',
    short: 'GOLDBEES',
    color: 'var(--c-cat-2)',
  },
  goldUsd: {
    label: 'Gold, world ($/oz)',
    tick: 'Gold, world price ($ per ounce)',
    short: 'Gold $',
    color: 'var(--c-cat-4)',
    dash: '6 4',
    shape: 'dash',
  },
};
const MARKET: MarketKey[] = ['nifty50', 'gold22k', 'gold24k', 'gold', 'goldUsd'];
const ORDER: LineKey[] = ['portfolio', ...MARKET];

/** Which lines are shown (remembered on this browser). */
type Choice = Record<LineKey, boolean>;
const CHOICE_KEY = 'pb-lines';
/** Before every line had its own tick box: Nifty, one Indian gold (or none), world gold. */
const OLD_CHOICE_KEY = 'pb-compare';
const DEFAULT_CHOICE: Choice = {
  portfolio: true,
  nifty50: true,
  gold22k: true,
  gold24k: false,
  gold: false,
  goldUsd: false,
};
function readChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null;
    if (!c) {
      const old = JSON.parse(localStorage.getItem(OLD_CHOICE_KEY) ?? 'null') as {
        nifty50?: boolean;
        goldIndiaOn?: boolean;
        goldIndia?: string;
        goldUsd?: boolean;
      } | null;
      if (!old) return DEFAULT_CHOICE;
      const india = (['gold22k', 'gold24k', 'gold'] as const).find((k) => k === old.goldIndia);
      return {
        ...DEFAULT_CHOICE,
        nifty50: old.nifty50 !== false,
        gold22k: old.goldIndiaOn !== false && (india ?? 'gold22k') === 'gold22k',
        gold24k: old.goldIndiaOn !== false && india === 'gold24k',
        gold: old.goldIndiaOn !== false && india === 'gold',
        goldUsd: old.goldUsd === true,
      };
    }
    return Object.fromEntries(
      ORDER.map((k) => [k, typeof c[k] === 'boolean' ? c[k] : DEFAULT_CHOICE[k]]),
    ) as Choice;
  } catch {
    return DEFAULT_CHOICE;
  }
}

function Picker({
  choice,
  keys,
  onChange,
}: {
  choice: Choice;
  keys: LineKey[];
  onChange: (c: Choice) => void;
}) {
  return (
    <fieldset className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <legend className="sr-only">Lines to show</legend>
      {keys.map((k) => (
        <span key={k} className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={choice[k]}
              aria-describedby={k === 'goldUsd' ? 'gold-usd-since' : undefined}
              onChange={(e) => onChange({ ...choice, [k]: e.target.checked })}
            />
            {LINES[k].tick}
          </label>
          {k === 'goldUsd' && (
            <span id="gold-usd-since" className="text-xs text-slate-500">
              — collected daily from 21 Oct 2026
            </span>
          )}
        </span>
      ))}
    </fieldset>
  );
}

/**
 * Your investments next to Nifty 50 and gold, each ticked on or off: % since a common start on
 * one axis, with the value itself (₹, ₹ per gram, $ per ounce) next to the % on hover and in
 * the table.
 */
export function ValueOverTime({ holdings }: { holdings: Holding[] }) {
  const me = useMe();
  // The chart's width, to tell which end labels sit close enough side by side to touch.
  const [width, setWidth] = useState(0);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const on = me.data?.family.livePrices ?? false;
  // Adding up day by day needs one currency; the markets can still be compared without yours.
  const single = oneCurrency(holdings);
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
  const currency = holdings.find((h) => !h.archived)?.currency ?? 'INR';
  // Market prices come with the daily NSE prices; without them only yours can be shown.
  const offered = ORDER.filter((k) => (k === 'portfolio' ? single : on));
  const ticked = useMemo(
    () => ORDER.filter((k) => choice[k] && (k === 'portfolio' ? single : on)),
    [choice, on, single],
  );
  const history = useMemo(() => valueHistory(holdings), [holdings]);
  const index = useMemo(
    () => returnIndex(holdings).map((p) => ({ date: p.date, value: p.index })),
    [holdings],
  );
  // A ticked market with no prices yet is left out (and named), so the rest still shows.
  const missing = useMemo(
    () =>
      bench.data
        ? ticked.filter((k) => k !== 'portfolio' && (bench.data[k as MarketKey] ?? []).length === 0)
        : [],
    [ticked, bench.data],
  );
  const keys = useMemo(() => ticked.filter((k) => !missing.includes(k)), [ticked, missing]);
  const rows = useMemo(() => {
    if (keys.some((k) => k !== 'portfolio') && !bench.data) return [];
    return compareSince(
      Object.fromEntries(
        keys.map((k) => [k, k === 'portfolio' ? index : (bench.data?.[k as MarketKey] ?? [])]),
      ),
    );
  }, [index, bench.data, keys]);

  const controls = (
    <>
      <Picker choice={choice} keys={offered} onChange={choose} />
      {!on && me.data && (
        <p className="-mt-1 mb-3 text-xs text-slate-500">
          Switch on “Daily closing prices from NSE” above to compare with Nifty 50 and gold.
        </p>
      )}
      {!single && (
        <p className="-mt-1 mb-3 text-xs text-slate-500">
          Your holdings are in different currencies, so they cannot be added up day by day — only
          the markets can be shown.
        </p>
      )}
      {missing.length > 0 && (
        <p className="-mt-1 mb-3 text-xs text-slate-500">
          No prices yet for {missing.map((k) => LINES[k].label).join(', ')}: they are collected each
          day from now on.
        </p>
      )}
    </>
  );
  const note = (text: string) => (
    <Card title="Value over time">
      {controls}
      <p className="text-sm text-slate-500">{text}</p>
    </Card>
  );
  if (me.isPending) return note('Loading…');
  if (keys.length === 0)
    return note(missing.length ? 'Nothing to draw yet.' : 'Tick at least one line to see it.');
  if (rows.length < 2) {
    const market = keys.some((k) => k !== 'portfolio');
    return note(
      market && bench.isError
        ? 'Market prices could not be loaded. Try again later.'
        : market && bench.isPending
          ? 'Loading…'
          : keys.includes('portfolio') && index.length < 2
            ? 'Each day with prices adds a point: switch on daily NSE prices above, or import your holdings again later, to see the trend.'
            : 'The comparison starts once all ticked lines have two days in common — untick one to start earlier.',
    );
  }
  // The markets may start later than yours: say how much of your history is left out.
  const yoursFrom = keys.includes('portfolio') && keys.length > 1 ? index[0]?.date : undefined;
  const cut = yoursFrom && yoursFrom < rows[0]!.date ? yoursFrom : undefined;

  const lines = keys.map((k) => ({ key: k, ...LINES[k] }));
  const values = rows
    .flatMap((r) => Object.values(r.change))
    .filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(0, ...values), Math.min(0, ...values));
  // Small moves get a decimal, so neighbouring ticks never read the same.
  const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
  // Each line is named at its own last point (a later day may have only some of the lines).
  const lastOf: Record<string, number> = Object.fromEntries(
    keys.map((k) => [k, rows.reduce((at, x, i) => (x.change[k] != null ? i : at), -1)]),
  );
  // End labels close enough to touch are spread apart (e.g. 22K and 24K gold, which move
  // alike), also when their lines end on different days. Pixels follow the plot: 256 high, 8
  // margin on top, a 30 high x axis; 52 for the y axis on the left, 72 for labels on the right.
  // Until the width is known, only labels ending on the same day count as close.
  const PLOT = { top: 8, height: 256 - 8 - 30, left: 52, width: Math.max(0, width - 52 - 72) };
  const [low, high] = [ticks[0]!, ticks.at(-1)!];
  const ended = keys.filter((k) => lastOf[k]! >= 0);
  const xOf = (k: LineKey) =>
    width > 0
      ? PLOT.left + (lastOf[k]! / Math.max(1, rows.length - 1)) * PLOT.width
      : lastOf[k]! * 1_000;
  const yOf = (k: LineKey) =>
    PLOT.top + ((high - (rows[lastOf[k]!]!.change[k] ?? 0)) / (high - low || 1)) * PLOT.height;
  const shift: Record<string, number> = {};
  for (const group of nearGroups(ended.map(xOf), 60)) {
    const ys = group.map((i) => yOf(ended[i]!));
    const placed = spreadLabels(ys, 12, PLOT.top, PLOT.top + PLOT.height);
    group.forEach((i, j) => (shift[ended[i]!] = placed[j]! - ys[j]!));
  }
  const data = rows.map((r) => ({ date: r.date, ...r.change }));
  /** The value itself next to its change, e.g. "₹13,400/g (+3.1 %)". */
  const value = (k: LineKey, v: number) =>
    k === 'portfolio'
      ? formatMoney(v, currency)
      : k === 'nifty50'
        ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
        : k === 'gold'
          ? inr(v, 2)
          : k === 'goldUsd'
            ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}/oz`
            : `${inr(v)}/g`;
  const cell = (r: (typeof rows)[number], k: LineKey) => {
    const change = pct(r.change[k] ?? null);
    // Yours: what it was worth that day (the % leaves out money added or taken out).
    // (the last value on or before the day, as the % is measured)
    const v =
      k === 'portfolio'
        ? r.change[k] == null
          ? null
          : history.filter((p) => p.date <= r.date).at(-1)?.value
        : r.price[k];
    return v == null ? change : `${value(k, v)} (${change})`;
  };
  return (
    <ChartCard
      title="Value over time"
      subtitle={`Change since ${dayLabel(rows[0]!.date)}${keys.includes('portfolio') ? ' — yours without money added or taken out' : ''}. Hover or show the table for the values.${cut ? ` Yours goes back to ${dayLabel(cut)} — untick the markets to see all of it.` : ''}`}
      controls={controls}
      legend={lines.map((l) => ({ label: l.label, color: l.color, shape: l.shape ?? 'line' }))}
      table={
        <DataTable
          head={['Date', ...lines.map((l) => l.label)]}
          rows={rows.map((r) => [dayLabel(r.date), ...lines.map((l) => cell(r, l.key))])}
        />
      }
    >
      <div className="h-64" ref={measure}>
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
                      dy={4 + (shift[l.key] ?? 0)}
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

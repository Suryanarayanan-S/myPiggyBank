import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
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
import { useMe } from '../../auth/auth';
import { Card } from '../ui/Card';
import { ChartCard, DataTable } from '../dashboard/ChartCard';
import { ChartTooltip } from '../dashboard/ChartTooltip';
import { LINES, type LineKey } from './ValueOverTime';
import { AXIS, GRID, MUTED, axisTick, niceTicks } from '../../lib/chart';
import { api } from '../../lib/api';
import type { Holding } from '../../lib/investments';
import { gainClass, signed } from '../../lib/investments';
import { formatCompact, formatMoney } from '../../lib/money';
import { oneCurrency } from '../../lib/portfolio';
import { sameMoneyComparison } from '../../lib/sameMoney';

type Point = { date: string; value: number };
/** The market lines bought with rupees (the world price is in dollars: not one of them). */
const MARKETS = ['nifty50', 'gold', 'gold24k', 'gold22k'] as const;
type Market = (typeof MARKETS)[number];
type Choice = Record<Market, boolean>;
const CHOICE_KEY = 'pb-same-money';
const DEFAULT_CHOICE: Choice = { nifty50: true, gold: true, gold24k: false, gold22k: false };

function readChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<Choice> | null;
    return Object.fromEntries(
      MARKETS.map((k) => [k, typeof c?.[k] === 'boolean' ? c[k] : DEFAULT_CHOICE[k]]),
    ) as Choice;
  } catch {
    return DEFAULT_CHOICE;
  }
}

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
const inr = (paise: number) => formatMoney(paise, 'INR');
const rate = (r: number | null) =>
  r === null ? '—' : `${r >= 0 ? '+' : '−'}${(Math.abs(r) * 100).toFixed(1)} % a year`;

/**
 * Your investments against the same money in Nifty 50 or gold: each buy and sale repeated on its
 * day for its amount, then the gain (or loss) of each over the money put in, day by day, and
 * where each stands today.
 */
export function SameMoney({ holdings }: { holdings: Holding[] }) {
  const me = useMe();
  const on = me.data?.family.livePrices ?? false;
  const single = oneCurrency(holdings);
  const currency = holdings.find((h) => !h.archived)?.currency ?? 'INR';
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
    queryFn: () =>
      api.get<Record<Market, Point[]> & { estimatedUntil: string | null }>('/holdings/benchmarks'),
    enabled: on && single && currency === 'INR',
  });
  // ticked, and with prices
  const ticked = useMemo(
    () => MARKETS.filter((k) => choice[k] && (bench.data?.[k]?.length ?? 0) > 0),
    [choice, bench.data],
  );
  const c = useMemo(
    () =>
      sameMoneyComparison(
        holdings,
        Object.fromEntries(ticked.map((k) => [k, bench.data?.[k] ?? []])),
      ),
    [holdings, bench.data, ticked],
  );

  const title = 'Your money against the same money elsewhere';
  if (!single || currency !== 'INR' || !on) {
    return (
      <Card title={title}>
        <p className="text-sm text-slate-500">
          {!on
            ? 'Switch on “Daily closing prices from NSE” to compare with Nifty 50 and gold.'
            : 'This compares rupee holdings with Indian markets: your holdings are in other currencies.'}
        </p>
      </Card>
    );
  }
  if (bench.isError) {
    return (
      <Card title={title}>
        <p className="text-sm text-slate-500">
          Market prices could not be loaded. Try again later.
        </p>
      </Card>
    );
  }
  if (bench.isPending || c.rows.length < 2) {
    return (
      <Card title={title}>
        <p className="text-sm text-slate-500">
          {bench.isPending ? 'Loading…' : 'It needs your buys and at least two days of prices.'}
        </p>
      </Card>
    );
  }

  const keys: LineKey[] = ['portfolio', ...ticked];
  const lines = keys.map((k) => ({
    key: k,
    ...LINES[k],
    label: k === 'portfolio' ? 'Your investments' : `Same money in ${LINES[k].short}`,
  }));
  const values = c.rows.flatMap((r) => Object.values(r.gain));
  const ticks = niceTicks(Math.max(0, ...values), Math.min(0, ...values));
  const data = c.rows.map((r) => ({ date: r.date, ...r.gain }));
  const byDate = new Map(c.rows.map((r) => [r.date, r]));
  const gainCell = (v: number | undefined) => (v === undefined ? '—' : signed(v, 'INR'));
  const best = keys.reduce((b, k) => (c.summary[k]!.gain > c.summary[b]!.gain ? k : b), keys[0]!);

  return (
    <ChartCard
      title={title}
      subtitle={`Each of your buys and sales repeated on its day, for its amount, in each market. Gain or loss over the money put in so far, net of sales (${inr(c.invested)} today). Dividends are left out on both sides.`}
      controls={
        <>
          <fieldset className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <legend className="sr-only">Markets to compare with</legend>
            {MARKETS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  // no prices for it yet: nothing to draw
                  checked={choice[k] && (bench.data?.[k]?.length ?? 0) > 0}
                  disabled={(bench.data?.[k]?.length ?? 0) === 0}
                  onChange={(e) => choose({ ...choice, [k]: e.target.checked })}
                />
                In {LINES[k].short}
              </label>
            ))}
          </fieldset>
          {bench.data?.estimatedUntil && (choice.gold24k || choice.gold22k) && (
            <p className="-mt-1 mb-3 text-xs text-slate-500">
              IBJA publishes no history: 22K and 24K gold before{' '}
              {dayLabel(bench.data.estimatedUntil)} are estimated from GOLDBEES.
            </p>
          )}
          <table className="mb-4 w-full text-sm">
            <caption className="sr-only">Where each stands today</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800">
                <th scope="col" className="py-2 font-medium">
                  Today
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Worth
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Gain / loss
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  XIRR <span className="font-normal">(prices only)</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800">
              {lines.map((l) => {
                const s = c.summary[l.key]!;
                return (
                  <tr key={l.key} className={clsx(l.key === 'portfolio' && 'font-medium')}>
                    <th scope="row" className="py-2 text-left font-normal">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-0.5 w-4"
                          style={{ background: l.color }}
                        />
                        {l.label}
                        {l.key === best && keys.length > 1 && (
                          <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            best
                          </span>
                        )}
                      </span>
                    </th>
                    <td className="py-2 text-right">{inr(s.value)}</td>
                    <td className={clsx('py-2 text-right', gainClass(s.gain))}>
                      {signed(s.gain, 'INR')}
                    </td>
                    <td className={clsx('py-2 text-right', gainClass(s.xirr ?? 0))}>
                      {rate(s.xirr)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      }
      legend={lines.map((l) => ({ label: l.label, color: l.color, shape: l.shape ?? 'line' }))}
      table={
        <DataTable
          head={['Date', 'Money put in (net)', ...lines.map((l) => l.label)]}
          rows={c.rows.map((r) => [
            dayLabel(r.date),
            inr(r.invested),
            ...lines.map((l) => gainCell(r.gain[l.key])),
          ])}
        />
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
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
              tickFormatter={(v: number) => formatCompact(v, 'INR')}
            />
            <ReferenceLine y={0} stroke={MUTED} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { date: string } | undefined;
                const r = p ? byDate.get(p.date) : undefined;
                return (
                  <ChartTooltip
                    active={active}
                    title={r ? `${dayLabel(r.date)} · put in (net) ${inr(r.invested)}` : undefined}
                    rows={
                      r
                        ? lines.map((l) => ({
                            label: l.label,
                            value: gainCell(r.gain[l.key]),
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
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

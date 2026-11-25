import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Wealth } from '../wealth/WealthOverview';
import { SummaryCard, Trend } from './SummaryCard';
import { AreaLine, BAD, FLAT, GOOD, dayLabel } from '../charts/AreaLine';
import { Ring } from '../charts/Ring';
import { localDay } from '../../lib/months';
import { api } from '../../lib/api';
import { formatCompact } from '../../lib/money';
import { useViewCurrency, withView } from '../../lib/viewCurrency';
import {
  CLASSES,
  CLASS_COLOR,
  type AssetClass,
  type NetWorthResponse,
} from '../../lib/wealthTypes';

const monthLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The family's net worth today as the dashboard's big card: the figure, how much it moved since
 * the first snapshot, what it is made of (a ring and a legend, largest first), and every
 * snapshot since as a line ending today. The whole card opens Family wealth.
 */
export function NetWorthSummary({ className }: { className?: string }) {
  const [view] = useViewCurrency();
  // the same request as the Wealth page, so the two share it
  const q = useQuery({
    queryKey: ['net-worth', view],
    queryFn: () => api.get<NetWorthResponse>(withView('/net-worth', view)),
  });
  const data = q.data;
  if (!data || (data.current.assets === 0 && data.current.liabilities === 0)) return null;
  const c = data.current;
  // every snapshot in this currency, oldest first, then today
  const snaps = data.snapshots
    .filter((s) => s.currency === c.currency && s.date < localDay())
    .sort((a, b) => a.date.localeCompare(b.date));
  const points = [
    ...snaps.map((s) => ({ t: Date.parse(`${s.date}T00:00:00Z`), v: s.netWorth })),
    { t: Date.parse(`${localDay()}T00:00:00Z`), v: c.netWorth },
  ];
  const first = snaps[0];
  const diff = first ? c.netWorth - first.netWorth : 0;
  const pct = first && first.netWorth > 0 ? (diff / first.netWorth) * 100 : null;
  const color = diff === 0 ? FLAT : diff > 0 ? GOOD : BAD;
  // largest first, like the breakdown on Family wealth
  const parts = (Object.keys(CLASSES) as AssetClass[])
    .filter((k) => c.byClass[k] > 0)
    .sort((a, b) => c.byClass[b] - c.byClass[a]);
  return (
    <SummaryCard
      to="/wealth"
      title="Net worth"
      opens="Family wealth"
      className={clsx('flex flex-col', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mt-0.5 text-4xl font-semibold tracking-tight tabular-nums">
            <Wealth cents={c.netWorth} currency={c.currency} />
          </p>
          {first && (
            <Trend diff={diff}>
              <span className="whitespace-nowrap tabular-nums">
                {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                {formatCompact(Math.abs(diff), c.currency)}
                {pct !== null && ` (${Math.abs(pct).toFixed(1)} %)`}
              </span>
              <span className="text-slate-500">since {monthLabel(first.date)}</span>
            </Trend>
          )}
        </div>
        {parts.length > 0 && (
          <div className="flex items-center gap-4">
            <ul className="space-y-1 text-xs" aria-label="Made of">
              {parts.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: CLASS_COLOR[k] }}
                  />
                  <span className="text-slate-600 dark:text-slate-300">{CLASSES[k]}</span>
                  <span className="ml-auto pl-3 text-slate-500 tabular-nums">
                    {formatCompact(c.byClass[k], c.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <Ring
              size={76}
              slices={parts.map((k) => ({ key: k, value: c.byClass[k], color: CLASS_COLOR[k] }))}
            />
          </div>
        )}
      </div>
      {points.length > 1 ? (
        <>
          <div className="mt-3 min-w-0 flex-1">
            <AreaLine data={points} currency={c.currency} color={color} height={150} decorative />
          </div>
          <p className="mt-1 flex justify-between text-xs text-slate-500 tabular-nums">
            <span>Since {dayLabel(points[0]!.t, true)} · first snapshot</span>
            <span>{dayLabel(points.at(-1)!.t, true)}</span>
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          {data.snapshots.some((s) => s.currency === c.currency)
            ? 'Your line starts with the next snapshot — today’s is the figure above.'
            : 'Save a snapshot on Family wealth now and then, and the line of your net worth grows here.'}
        </p>
      )}
      {c.unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Some amounts have no exchange rate and are left out.
        </p>
      )}
    </SummaryCard>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { EVENT_GROUPS, eventGroup, type EventGroup } from '../../lib/corporateActions';
import { dayLabel } from '../../lib/deposits';
import { gainClass, signed } from '../../lib/investments';
import { formatMoney } from '../../lib/money';

type Event = {
  holdingId: string;
  symbol: string;
  exDate: string;
  purpose: string;
  kind: 'split' | 'bonus' | 'consolidation' | 'review';
  unitsBefore: number;
  unitsAfter: number;
  received: { symbol: string; units: number; pricedOn: string | null }[];
  unlinked: boolean;
  valueBefore: number | null;
  valueAfter: number | null;
  change: number | null;
};

const inr = (paise: number) => formatMoney(paise, 'INR');
const shares = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'share' : 'shares'}`;

/** ", until X first traded on 12 Nov 2025" when a received share listed after the ex-date. */
const later = (e: Event) =>
  e.received
    .filter((r) => r.pricedOn && r.pricedOn > e.exDate)
    .map((r) => `, until ${r.symbol} first traded on ${dayLabel(r.pricedOn!)}`)
    .join('');

/** What it did to the shares, in words. */
function effect(e: Event) {
  const got = e.received.map((r) => `${shares(r.units)} of ${r.symbol}`).join(' and ');
  if (e.kind === 'review')
    return `${shares(e.unitsBefore)} → ${e.unitsAfter ? shares(e.unitsAfter) : 'none'}${got ? `, and ${got} received` : ''}`;
  return `${shares(e.unitsBefore)} → ${shares(e.unitsAfter)}`;
}

/**
 * Splits, bonuses, demergers and mergers of the holdings, one tab each (splits, bonuses, the
 * rest), as a timeline that scrolls when long: shares before and after, and the value just before
 * and just after. A split or bonus itself neither gains nor loses — what changes is the day's
 * market move; a demerger or merger shows what the new shares were worth.
 */
export function CorporateHistory({
  holdingIds = null,
}: {
  /** only these holdings' (the demats chosen on the Market page); null: all */
  holdingIds?: Set<string> | null;
}) {
  const q = useQuery({
    queryKey: ['holdings', 'events'],
    queryFn: () => api.get<Event[]>('/holdings/events'),
    // read from what a lookup kept: no need to ask often
    staleTime: 5 * 60_000,
  });
  const [chosen, setChosen] = useState<EventGroup | null>(null);
  const events = (q.data ?? []).filter((e) => !holdingIds || holdingIds.has(e.holdingId));
  if (events.length === 0) return null;
  const count = (g: EventGroup) => events.filter((e) => eventGroup(e.kind) === g).length;
  // the chosen tab, or the first with something in it
  const group =
    chosen && count(chosen) > 0 ? chosen : EVENT_GROUPS.find((g) => count(g.key) > 0)!.key;
  const shown = events.filter((e) => eventGroup(e.kind) === group);

  return (
    <Card title="Splits, bonuses and mergers" className="!pb-2">
      <div
        role="tablist"
        aria-label="Kind of corporate action"
        className="mb-2 flex gap-1 overflow-x-auto border-b border-slate-200 whitespace-nowrap dark:border-slate-800"
      >
        {EVENT_GROUPS.map((g) => {
          const n = count(g.key);
          const on = g.key === group;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              id={`ca-tab-${g.key}`}
              aria-selected={on}
              aria-controls="ca-panel"
              disabled={n === 0}
              onClick={() => setChosen(g.key)}
              className={clsx(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium disabled:opacity-40',
                on
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )}
            >
              {g.label} <span className="text-xs tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      <div
        // each tab starts at the top
        key={group}
        id="ca-panel"
        role="tabpanel"
        aria-labelledby={`ca-tab-${group}`}
        tabIndex={0}
        className="max-h-[28rem] overflow-y-auto pr-1 focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {shown.map((e) => (
            <li
              key={`${e.symbol}|${e.exDate}|${e.purpose}`}
              className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8rem_1fr_auto]"
            >
              <p className="min-w-0 font-medium break-words">{e.symbol}</p>
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-slate-500">{e.purpose}</p>
                <p className="text-slate-700 dark:text-slate-200">{effect(e)}</p>
                {e.valueBefore !== null && e.valueAfter !== null && e.change !== null ? (
                  <p className="text-xs text-slate-500 tabular-nums">
                    Worth {inr(e.valueBefore)} the day before, {inr(e.valueAfter)} after:{' '}
                    <span className={clsx('font-medium', gainClass(e.change))}>
                      {signed(e.change, 'INR')}
                    </span>
                    {e.kind !== 'review'
                      ? ' — the day’s market move; a split or bonus itself gains or loses nothing.'
                      : ` — including the market’s move${later(e)}.`}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    {/^rights/i.test(e.purpose)
                      ? 'A rights offer: nothing changes unless it is taken up.'
                      : e.unlinked
                        ? 'The new company’s shares are not tied to it here (they carry the original buy dates), so no gain or loss is shown.'
                        : 'The prices around that day are not known.'}
                  </p>
                )}
              </div>
              <p className="text-xs whitespace-nowrap text-slate-500 tabular-nums sm:text-right">
                {dayLabel(e.exDate)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

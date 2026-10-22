import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
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
 * Splits, bonuses, demergers and mergers of the holdings: shares before and after, and the value
 * just before and just after. A split or bonus itself neither gains nor loses — what changes is
 * the day's market move; a demerger or merger shows what the new shares were worth.
 */
export function CorporateHistory() {
  const q = useQuery({
    queryKey: ['holdings', 'events'],
    queryFn: () => api.get<Event[]>('/holdings/events'),
    // read from what a lookup kept: no need to ask often
    staleTime: 5 * 60_000,
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Card title="Splits, bonuses and mergers">
      <ul className="space-y-3 text-sm">
        {q.data.map((e) => (
          <li key={`${e.symbol}|${e.exDate}|${e.purpose}`}>
            <p>
              <span className="font-medium">{e.symbol}</span>{' '}
              <span className="text-slate-500">
                · {e.purpose} · {dayLabel(e.exDate)}
              </span>
            </p>
            <p className="text-slate-600 dark:text-slate-300">{effect(e)}</p>
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
          </li>
        ))}
      </ul>
    </Card>
  );
}

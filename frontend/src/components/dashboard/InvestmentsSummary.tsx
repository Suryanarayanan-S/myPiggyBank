import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { gainClass, signed, type HoldingsResponse } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { dayTotal, portfolioXirr } from '../../lib/portfolio';
import { payoutTotals, rangeOf, selectPayouts, type Payout } from '../../lib/payouts';
import { localDay } from '../../lib/months';
import { maturingSoon, useDeposits, whenLeft } from '../../lib/deposits';
import { useGold } from '../../lib/gold';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Investments at a glance: worth now (rupee and euro shares apart when there are both), gain so
 * far, the latest market day's move, the yearly return (XIRR) and this financial year's dividends
 * and interest; deposits and gold.
 */
export function InvestmentsSummary() {
  const [view] = useViewCurrency();
  // the same request as the Investments page, so the two share it
  const q = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const payouts = useQuery({
    queryKey: ['holdings', 'payouts'],
    queryFn: () => api.get<Payout[]>('/holdings/payouts'),
    // only with holdings to show it for
    enabled: !!q.data && q.data.holdings.length > 0,
  });
  const deposits = useDeposits();
  const gold = useGold().data?.summary;
  const data = q.data;
  const dep = deposits.data?.summary;
  const hasMarket = !!data && data.summary.value !== 0;
  const summary = data?.summary ?? null;
  const hasDeposits = !!dep && (dep.value !== 0 || dep.unconverted.length > 0);
  // Deposits show even while the holdings load (or when they fail).
  const hasGold = !!gold && (gold.value !== 0 || gold.unconverted.length > 0);
  if (!hasMarket && !hasDeposits && !hasGold) return null;
  // a reminder a month ahead, and for matured deposits not yet marked paid out
  const soon = maturingSoon(deposits.data?.deposits ?? [], 30);
  const day = data ? dayTotal(data.holdings) : null;
  const today = localDay();
  const fy = rangeOf('fy', today);
  const received = payoutTotals(
    selectPayouts(payouts.data ?? [], {
      kind: 'all',
      from: fy.from,
      to: fy.to,
      search: '',
      sort: 'date',
      desc: true,
    }),
  ).amounts;
  // what is held, per currency (a share bought in euros stays in euros here)
  const held = new Map<string, number>();
  for (const h of data?.holdings ?? [])
    if (!h.archived && h.value) held.set(h.currency, (held.get(h.currency) ?? 0) + h.value);
  const currencies = [...held.keys()].sort((a, b) => Number(b === 'INR') - Number(a === 'INR'));
  // a holding with no price yet would count as worth nothing: no rate for its currency then
  const unpriced = new Set(
    (data?.holdings ?? [])
      .filter((h) => !h.archived && Number(h.units) > 0 && h.value === null)
      .map((h) => h.currency),
  );
  const xirrs = currencies
    .filter((c) => !unpriced.has(c))
    .map((c) => ({ currency: c, x: portfolioXirr(data!.holdings, c, today) }))
    .filter((r) => r.x !== null);
  const gainBp =
    summary && summary.invested > 0
      ? Math.round((summary.unrealised * 10_000) / summary.invested)
      : null;
  return (
    <Card
      title="Investments"
      actions={
        <Link to="/investments" className="text-sm text-indigo-600 hover:underline">
          All investments
        </Link>
      }
    >
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {hasMarket && summary && (
          <>
            <div>
              <dt className="text-xs text-slate-500">Market value</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatMoney(summary.value, summary.currency)}
              </dd>
              {summary.unconverted.length > 0 && (
                <dd className="text-xs text-amber-700 dark:text-amber-400">
                  + {summary.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' + ')}{' '}
                  without an exchange rate
                </dd>
              )}
            </div>
            <div>
              <dt className="text-xs text-slate-500">Gain so far</dt>
              <dd
                className={clsx(
                  'text-lg font-semibold tabular-nums',
                  gainClass(summary.unrealised),
                )}
              >
                {signed(summary.unrealised, summary.currency)}
                {gainBp !== null && <span className="ml-1 text-sm">{formatPercent(gainBp)}</span>}
              </dd>
            </div>
            {currencies.length > 1 && (
              <div>
                <dt className="text-xs text-slate-500">By currency</dt>
                <dd className="text-sm font-medium tabular-nums">
                  {currencies.map((c) => (
                    <span key={c} className="block">
                      {formatMoney(held.get(c)!, c)}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {xirrs.length > 0 && (
              <div>
                <dt className="text-xs text-slate-500">XIRR · a year</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {xirrs.map((r) => (
                    <span key={r.currency} className={clsx('block', gainClass(r.x!.rate))}>
                      {r.x!.rate >= 0 ? '+' : ''}
                      {formatPercent(Math.round(r.x!.rate * 10_000))}
                      {xirrs.length > 1 && (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          {r.currency}
                        </span>
                      )}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {received.length > 0 && (
              <div>
                <dt className="text-xs text-slate-500">Dividends & interest · this FY</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {received.map((t) => formatMoney(t.amount, t.currency)).join(' + ')}
                </dd>
              </div>
            )}
            {day && (
              <div>
                <dt className="text-xs text-slate-500">Day · {dayLabel(day.date)}</dt>
                <dd className={clsx('text-lg font-semibold tabular-nums', gainClass(day.pnl))}>
                  {signed(day.pnl, summary.currency)}
                  <span className="ml-1 text-sm">{formatPercent(day.changeBp)}</span>
                </dd>
              </div>
            )}
          </>
        )}
        {hasDeposits && (
          <div>
            <dt className="text-xs text-slate-500">Deposits</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {/* without an exchange rate: in their own currency */}
              {[
                ...(dep.value !== 0 ? [formatMoney(dep.value, dep.currency)] : []),
                ...dep.unconverted.map((u) => formatMoney(u.amount, u.currency)),
              ].join(' + ')}
            </dd>
          </div>
        )}
        {hasGold && (
          <div>
            <dt className="text-xs text-slate-500">Gold</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {/* without an exchange rate: in rupees */}
              {[
                ...(gold.value !== 0 ? [formatMoney(gold.value, gold.currency)] : []),
                ...gold.unconverted.map((u) => formatMoney(u.amount, u.currency)),
              ].join(' + ')}
            </dd>
          </div>
        )}
      </dl>
      {soon.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
          {soon.map((d) => (
            <li key={d.id}>
              <span className="font-medium">{d.name}</span> {d.daysLeft > 0 ? 'matures' : 'matured'}{' '}
              {whenLeft(d.daysLeft)}:{' '}
              <span className="tabular-nums">{formatMoney(d.maturityAmount, d.currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

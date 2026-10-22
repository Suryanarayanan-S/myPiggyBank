import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { gainClass, signed, type HoldingsResponse } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { dayTotal } from '../../lib/portfolio';
import { maturingSoon, useDeposits, whenLeft } from '../../lib/deposits';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** Investments at a glance: worth now, gain so far and the latest market day's move. */
export function InvestmentsSummary() {
  const [view] = useViewCurrency();
  // the same request as the Investments page, so the two share it
  const q = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const deposits = useDeposits();
  const data = q.data;
  const dep = deposits.data?.summary;
  const hasMarket = !!data && data.summary.value !== 0;
  const summary = data?.summary ?? null;
  const hasDeposits = !!dep && (dep.value !== 0 || dep.unconverted.length > 0);
  // Deposits show even while the holdings load (or when they fail).
  if (!hasMarket && !hasDeposits) return null;
  // a reminder a month ahead, and for matured deposits not yet marked paid out
  const soon = maturingSoon(deposits.data?.deposits ?? [], 30);
  const day = data ? dayTotal(data.holdings) : null;
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

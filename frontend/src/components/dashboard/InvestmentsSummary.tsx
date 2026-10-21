import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { gainClass, signed, type HoldingsResponse } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { dayTotal } from '../../lib/portfolio';
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
  const data = q.data;
  if (!data || data.summary.value === 0) return null;
  const { summary } = data;
  const day = dayTotal(data.holdings);
  const gainBp =
    summary.invested > 0 ? Math.round((summary.unrealised * 10_000) / summary.invested) : null;
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
        <div>
          <dt className="text-xs text-slate-500">Current value</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {formatMoney(summary.value, summary.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Gain so far</dt>
          <dd className={clsx('text-lg font-semibold tabular-nums', gainClass(summary.unrealised))}>
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
      </dl>
    </Card>
  );
}

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { useMe } from '../auth/auth';
import { CashFlowChart } from '../components/dashboard/CashFlowChart';
import { Insights } from '../components/dashboard/Insights';
import { PeriodFilter } from '../components/dashboard/PeriodFilter';
import { CategoryBars, MemberBars } from '../components/dashboard/RankBars';
import { StatTiles } from '../components/dashboard/StatTiles';
import { SavingsRateChart, ShareChart } from '../components/dashboard/TrendCharts';
import { StatusBadge } from '../components/goals/GoalCard';
import { Card } from '../components/ui/Card';
import { Progress } from '../components/ui/Progress';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import type { Dashboard } from '../lib/dashboardTypes';
import { insightsFor } from '../lib/insights';
import { formatMoney } from '../lib/money';
import { isMonth, localMonth, monthTitle } from '../lib/months';
import { PRESETS, periodRange, type Preset } from '../lib/periods';
import { useGoals } from '../lib/queries';
import { useViewCurrency, withView } from '../lib/viewCurrency';

export function DashboardPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const today = localMonth();
  const [view] = useViewCurrency();
  const preset = (
    PRESETS.some((p) => p.value === params.get('period')) ? params.get('period') : 'last-12'
  ) as Preset;
  const custom = {
    from: isMonth(params.get('from')) ? params.get('from')! : today,
    to: isMonth(params.get('to')) ? params.get('to')! : today,
  };

  // "All time" needs the first recorded month, which the API returns with every response.
  const first = useQuery({
    queryKey: ['dashboard', 'first'],
    queryFn: () => api.get<Dashboard>(`/dashboard?from=${today}&to=${today}`),
    select: (d) => d.firstMonth,
    enabled: preset === 'all',
  });
  const range = periodRange(preset, today, first.data ?? null, custom);
  const dash = useQuery({
    queryKey: ['dashboard', range.from, range.to, view],
    queryFn: () =>
      api.get<Dashboard>(withView(`/dashboard?from=${range.from}&to=${range.to}`, view)),
    placeholderData: keepPreviousData,
    enabled: preset !== 'all' || first.isSuccess,
  });
  const d = dash.data;

  const change = (p: Preset, c?: { from: string; to: string }) =>
    setParams(p === 'custom' && c ? { period: p, from: c.from, to: c.to } : { period: p }, {
      replace: true,
    });

  const label =
    range.from === range.to
      ? monthTitle(range.from)
      : `${monthTitle(range.from)} – ${monthTitle(range.to)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {me.data ? `Hello, ${me.data.user.name}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-slate-500">{label}</p>
        </div>
      </div>
      <PeriodFilter preset={preset} custom={custom} onChange={change} />
      <FormError error={dash.error} />

      {d && (
        <div
          className={
            dash.isPlaceholderData ? 'space-y-5 opacity-60 transition-opacity' : 'space-y-5'
          }
        >
          {d.totals.netIncome === 0 && d.totals.spent === 0 && d.totals.future === 0 ? (
            <Card>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Nothing recorded for this period yet. Add transactions, use{' '}
                <Link to="/budget/entry" className="font-medium text-indigo-600 underline">
                  Quick entry
                </Link>
                , or{' '}
                <Link to="/import" className="font-medium text-indigo-600 underline">
                  import your spreadsheet
                </Link>
                .
              </p>
            </Card>
          ) : null}
          {d.unconverted.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {d.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(' and ')} in
                  this period could not be converted to {d.currency} and is left out.{' '}
                  <Link to="/settings" className="font-medium underline">
                    Add exchange rates
                  </Link>
                  .
                </span>
              </p>
            </Card>
          )}
          <StatTiles d={d} />
          {(!d.previous && d.previousCoverage.recorded > 0) || range.to === today ? (
            <p className="-mt-2 text-xs text-slate-500">
              {!d.previous && d.previousCoverage.recorded > 0
                ? `No comparison with the previous period: only ${d.previousCoverage.recorded} of its ${d.previousCoverage.months} months are recorded. `
                : ''}
              {range.to === today
                ? 'This period includes the current month, which is still in progress.'
                : ''}
            </p>
          ) : null}
          <Insights
            items={insightsFor(d.totals, d.previous, d.targets, d.currency, d.categories)}
          />
          <CashFlowChart d={d} />
          <div className="grid gap-5 lg:grid-cols-2">
            <SavingsRateChart d={d} />
            <ShareChart d={d} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <CategoryBars d={d} />
            <MemberBars d={d} />
          </div>
          <GoalsSummary />
          {d.accounts.length > 0 && (
            <Card title="Account balances today">
              <dl className="flex flex-wrap gap-x-8 gap-y-2">
                {(d.accounts.length > 1 || d.accounts[0]?.currency !== d.currency) && (
                  <div>
                    <dt className="text-xs text-slate-500">All accounts in {d.currency}</dt>
                    <dd className="text-lg font-semibold">
                      {formatMoney(d.accountsTotal.total, d.currency)}
                      {d.accountsTotal.unconverted.length > 0 && (
                        <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-400">
                          +{' '}
                          {d.accountsTotal.unconverted
                            .map((u) => formatMoney(u.amount, u.currency))
                            .join(' + ')}{' '}
                          without a rate
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {d.accounts.map((a) => (
                  <div key={a.currency}>
                    <dt className="text-xs text-slate-500">{a.currency} accounts</dt>
                    <dd className="text-lg font-semibold">{formatMoney(a.balance, a.currency)}</dd>
                  </div>
                ))}
              </dl>
              <Link
                to="/accounts"
                className="mt-2 inline-block text-sm text-indigo-600 hover:underline"
              >
                See accounts
              </Link>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** Up to three active goals, nearest date first; hidden when there are none. */
function GoalsSummary() {
  const goals = useGoals();
  const active = (goals.data ?? []).filter((g) => g.status === 'active').slice(0, 3);
  if (active.length === 0) return null;
  return (
    <Card
      title="Goals"
      actions={
        <Link to="/goals" className="text-sm text-indigo-600 hover:underline">
          All goals
        </Link>
      }
    >
      <ul className="space-y-4">
        {active.map((g) => (
          <li key={g.id}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                {g.name} <StatusBadge goal={g} />
              </span>
              <span className="text-slate-500 tabular-nums">
                {formatMoney(g.saved, g.currency)} of {formatMoney(g.targetAmount, g.currency)}
              </span>
            </div>
            <Progress
              label={`${g.name} saved of target`}
              value={Math.max(0, g.progress.pctBp) / 10_000}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { useMe } from '../auth/auth';
import { Attention } from '../components/dashboard/Attention';
import { CashFlowChart } from '../components/dashboard/CashFlowChart';
import { Insights } from '../components/dashboard/Insights';
import { InvestmentsSummary } from '../components/dashboard/InvestmentsSummary';
import { NetWorthSummary } from '../components/dashboard/NetWorthSummary';
import { PeriodFilter } from '../components/dashboard/PeriodFilter';
import { StatTiles } from '../components/dashboard/StatTiles';
import { useDashboardPeriod } from '../components/dashboard/useDashboardPeriod';
import { StatusBadge } from '../components/goals/GoalCard';
import { Card } from '../components/ui/Card';
import { Progress } from '../components/ui/Progress';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import { insightsFor } from '../lib/insights';
import { useBucketNames } from '../lib/buckets';
import { insightText, type InsightsResponse } from '../lib/insightText';
import { formatMoney } from '../lib/money';
import { useGoals } from '../lib/queries';
import { withView } from '../lib/viewCurrency';

export function DashboardPage() {
  const me = useMe();
  const names = useBucketNames();
  const { today, view, preset, custom, range, dash, change, label } = useDashboardPeriod();
  const d = dash.data;
  const observations = useQuery({
    queryKey: ['insights', view],
    queryFn: () => api.get<InsightsResponse>(withView('/insights', view)),
  });

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
      {/* today's picture first (each loads on its own), then the chosen period's figures */}
      <Attention uncategorised={d?.uncategorised ?? null} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <NetWorthSummary />
        <InvestmentsSummary />
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
                <Link to="/transactions/import" className="font-medium text-indigo-600 underline">
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
            more
            failed={observations.isError}
            items={[
              // the three most important observations of the last months, then this period's
              ...(observations.data?.insights.slice(0, 3).map((i) => ({
                tone: i.tone,
                text: insightText(i, observations.data!.currency),
                link: i.link,
              })) ?? []),
              ...insightsFor(d.totals, d.previous, d.targets, d.currency, d.categories, names),
            ]}
          />
          <CashFlowChart d={d} />
          <p className="-mt-2 text-sm">
            <Link
              to={`/budget/overview?${new URLSearchParams(
                preset === 'custom'
                  ? { period: preset, from: custom.from, to: custom.to }
                  : { period: preset },
              )}`}
              className="text-indigo-600 hover:underline"
            >
              Savings rate, 50/30/20 and where the money went: Budget → Overview
            </Link>
          </p>
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
                to="/wealth/accounts"
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

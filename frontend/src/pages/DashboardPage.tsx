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
import { Headline, SummaryCard } from '../components/dashboard/SummaryCard';
import { Wealth } from '../components/wealth/WealthOverview';
import type { Dashboard } from '../lib/dashboardTypes';
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

  // Spending → Overview for the same period (savings rate, 50/30/20, where the money went)
  const spendingLink = `/spending?${new URLSearchParams(
    preset === 'custom' ? { period: preset, from: custom.from, to: custom.to } : { period: preset },
  )}`;

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
      {/* where things stand today: each card opens its page */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <NetWorthSummary />
        <InvestmentsSummary />
        {d && <CashSummary d={d} />}
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
                <Link to="/spending/entry" className="font-medium text-indigo-600 underline">
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
          <StatTiles d={d} to={spendingLink} />
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
          <GoalsSummary />
        </div>
      )}
    </div>
  );
}

/** Up to three active goals, nearest date first; the card opens all goals. Hidden without any. */
function GoalsSummary() {
  const goals = useGoals();
  const active = (goals.data ?? []).filter((g) => g.status === 'active').slice(0, 3);
  if (active.length === 0) return null;
  return (
    <SummaryCard to="/wealth/goals" title="Goals" opens="all goals">
      <ul className="mt-3 space-y-4">
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
    </SummaryCard>
  );
}

/** Money in the accounts today (all currencies in the dashboard one); the card opens Accounts. */
function CashSummary({ d }: { d: Dashboard }) {
  if (d.accounts.length === 0) return null;
  const t = d.accountsTotal;
  const several = d.accounts.length > 1 || d.accounts[0]?.currency !== d.currency;
  return (
    <SummaryCard to="/transactions/accounts" title="Cash" opens="Accounts">
      <Headline>
        <Wealth cents={several ? t.total : d.accounts[0]!.balance} currency={d.currency} />
      </Headline>
      <p className="mt-1 text-sm text-slate-500">in your accounts today</p>
      {several && (
        <ul className="mt-4 space-y-1 text-sm" aria-label="By currency">
          {d.accounts.map((a) => (
            <li key={a.currency} className="flex justify-between gap-3">
              <span className="text-slate-500">{a.currency} accounts</span>
              <span className="font-medium tabular-nums">{formatMoney(a.balance, a.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {t.unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Not in the total (no exchange rate):{' '}
          {t.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
    </SummaryCard>
  );
}

import { Link } from 'react-router';
import { PeriodFilter } from '../components/dashboard/PeriodFilter';
import { CategoryBars, MemberBars } from '../components/dashboard/RankBars';
import { SavingsRateChart, ShareChart } from '../components/dashboard/TrendCharts';
import { useDashboardPeriod } from '../components/dashboard/useDashboardPeriod';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';

/**
 * The budget over a period (the Budget tab shows one month): the savings rate and the 50/30/20
 * split month by month, the biggest categories and what each person spent.
 */
export function BudgetOverviewPage() {
  const { preset, custom, dash, change, label } = useDashboardPeriod();
  const d = dash.data;
  const empty = d && d.totals.netIncome === 0 && d.totals.spent === 0 && d.totals.future === 0;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Spending overview</h1>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
      <PeriodFilter preset={preset} custom={custom} onChange={change} />
      <FormError error={dash.error} />
      {empty && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing recorded for this period yet. Add transactions or use{' '}
            <Link to="/spending/entry" className="font-medium text-indigo-600 underline">
              Quick entry
            </Link>
            .
          </p>
        </Card>
      )}
      {d && !empty && (
        <div
          className={
            dash.isPlaceholderData ? 'space-y-5 opacity-60 transition-opacity' : 'space-y-5'
          }
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <SavingsRateChart d={d} />
            <ShareChart d={d} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <CategoryBars d={d} />
            <MemberBars d={d} />
          </div>
        </div>
      )}
    </div>
  );
}

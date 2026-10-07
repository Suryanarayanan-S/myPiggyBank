import clsx from 'clsx';
import { Card } from '../ui/Card';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import type { MonthSummary } from '../../lib/types';

export function SummaryCards({ s }: { s: MonthSummary }) {
  const items = [
    { label: 'Net income', value: formatMoney(s.netIncome, s.currency) },
    { label: 'Spent', hint: 'Essentials + Fun', value: formatMoney(s.spent, s.currency) },
    { label: 'Future You', hint: 'saved & invested', value: formatMoney(s.future, s.currency) },
    {
      label: 'Unused',
      value: formatMoney(s.unused, s.currency),
      tone: s.unused < 0 ? 'bad' : undefined,
    },
    { label: 'Savings rate', hint: 'Future You + unused', value: formatPercent(s.savingsRateBp) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((i) => (
        <Card key={i.label} className="!p-4">
          <p className="text-xs font-medium text-slate-500">{i.label}</p>
          <p
            className={clsx(
              'mt-1 text-xl font-semibold tabular-nums',
              i.tone === 'bad' && 'text-rose-600 dark:text-rose-400',
            )}
          >
            {i.value}
          </p>
          {i.hint && <p className="text-xs text-slate-400">{i.hint}</p>}
        </Card>
      ))}
    </div>
  );
}

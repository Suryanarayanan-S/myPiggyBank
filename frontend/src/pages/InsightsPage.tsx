import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { ICON } from '../components/dashboard/Insights';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { api } from '../lib/api';
import { insightText, type InsightsResponse } from '../lib/insightText';
import { formatMoney } from '../lib/money';
import { useViewCurrency, withView } from '../lib/viewCurrency';

export function InsightsPage() {
  const [view] = useViewCurrency();
  const q = useQuery({
    queryKey: ['insights', view],
    queryFn: () => api.get<InsightsResponse>(withView('/insights', view)),
  });
  const data = q.data;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-slate-500">
          What stands out in this month and the six before it — worked out from your own numbers.
          Not financial advice.
        </p>
      </div>
      <FormError error={q.error} />
      {data && data.unconverted.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          Left out (no exchange rate to {data.currency}):{' '}
          {data.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
      {data && (
        <Card>
          {data.insights.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Nothing stands out right now. Insights appear as months of spending, limits, goals and
              investments come in.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.insights.map((i) => {
                const { Icon, className, label } = ICON[i.tone];
                return (
                  <li key={i.id} className="flex items-start gap-3 py-3 text-sm">
                    <Icon size={18} className={`mt-0.5 shrink-0 ${className}`} aria-label={label} />
                    <span className="flex-1">{insightText(i, data.currency)}</span>
                    <Link to={i.link} className="shrink-0 text-indigo-600 hover:underline">
                      See
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card } from '../ui/Card';
import { Change, Wealth } from '../wealth/WealthOverview';
import { api } from '../../lib/api';
import { useViewCurrency, withView } from '../../lib/viewCurrency';
import type { NetWorthResponse } from '../../lib/wealthTypes';

/** The family's net worth today, its change since the last snapshot, and each person's share. */
export function NetWorthSummary() {
  const [view] = useViewCurrency();
  // the same request as the Wealth page, so the two share it
  const q = useQuery({
    queryKey: ['net-worth', view],
    queryFn: () => api.get<NetWorthResponse>(withView('/net-worth', view)),
  });
  const data = q.data;
  if (!data || (data.current.assets === 0 && data.current.liabilities === 0)) return null;
  const c = data.current;
  const people = c.columns.filter((m) => m.netWorth !== 0);
  return (
    <Card
      title="Net worth"
      actions={
        <Link to="/wealth" className="text-sm text-indigo-600 hover:underline">
          Family wealth
        </Link>
      }
    >
      <p className="text-3xl font-semibold tracking-tight">
        <Wealth cents={c.netWorth} currency={c.currency} />
      </p>
      <Change now={c.netWorth} then={data.previousMonth} currency={c.currency} />
      {people.length > 1 && (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {people.map((m) => (
            <div key={m.memberId ?? 'shared'}>
              <dt className="text-xs text-slate-500">{m.name}</dt>
              <dd className="font-semibold">
                <Wealth cents={m.netWorth} currency={c.currency} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {c.unconverted.length > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Some amounts have no exchange rate and are left out.
        </p>
      )}
    </Card>
  );
}

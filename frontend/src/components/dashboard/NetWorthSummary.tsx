import { useQuery } from '@tanstack/react-query';
import { Home, Landmark, Package, TrendingUp, type LucideIcon } from 'lucide-react';
import { Wealth } from '../wealth/WealthOverview';
import { Headline, IconRow, SummaryCard, Trend } from './SummaryCard';
import { api } from '../../lib/api';
import { formatCompact } from '../../lib/money';
import { useViewCurrency, withView } from '../../lib/viewCurrency';
import {
  CLASSES,
  CLASS_COLOR,
  type AssetClass,
  type NetWorthResponse,
} from '../../lib/wealthTypes';

const CLASS_ICON: Record<AssetClass, LucideIcon> = {
  liquid: Landmark,
  property: Home,
  investment: TrendingUp,
  other: Package,
};

const sinceLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The family's net worth today and its change since the last snapshot a month back, with what
 * it is made of as a row of icons. The whole card opens Family wealth.
 */
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
  const then = data.previousMonth;
  const diff = then ? c.netWorth - then.netWorth : 0;
  // largest first, like the breakdown on Family wealth
  const parts = (Object.keys(CLASSES) as AssetClass[])
    .filter((k) => c.byClass[k] > 0)
    .sort((a, b) => c.byClass[b] - c.byClass[a])
    .map((k) => ({
      key: k,
      label: `${CLASSES[k]} ${formatCompact(c.byClass[k], c.currency)}`,
      Icon: CLASS_ICON[k],
      color: CLASS_COLOR[k],
    }));
  return (
    <SummaryCard to="/wealth" title="Net worth" opens="Family wealth">
      <Headline>
        <Wealth cents={c.netWorth} currency={c.currency} />
      </Headline>
      {then && (
        <Trend diff={diff}>
          <span className="whitespace-nowrap">
            {diff >= 0 ? '+' : '−'}
            {formatCompact(Math.abs(diff), c.currency)}
          </span>
          <span className="text-slate-500">since {sinceLabel(then.date)}</span>
        </Trend>
      )}
      <IconRow parts={parts} label="Made of" />
      {c.unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Some amounts have no exchange rate and are left out.
        </p>
      )}
    </SummaryCard>
  );
}

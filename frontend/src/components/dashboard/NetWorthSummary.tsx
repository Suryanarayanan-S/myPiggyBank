import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ChevronRight, Home, Landmark, Package, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Change, Wealth } from '../wealth/WealthOverview';
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
  // largest first, like the breakdown on Family wealth
  const parts = (Object.keys(CLASSES) as AssetClass[])
    .filter((k) => c.byClass[k] > 0)
    .sort((a, b) => c.byClass[b] - c.byClass[a]);
  return (
    <Link
      to="/wealth"
      className="group block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
    >
      <h2 className="flex items-center gap-0.5 text-sm font-medium text-slate-500">
        Net worth
        <ChevronRight
          size={16}
          className="transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
        <span className="sr-only">— open Family wealth</span>
      </h2>
      <p className="mt-1 text-3xl font-semibold tracking-tight">
        <Wealth cents={c.netWorth} currency={c.currency} />
      </p>
      <Change now={c.netWorth} then={data.previousMonth} currency={c.currency} />
      {parts.length > 0 && (
        <ul className="mt-5 flex" aria-label="Made of">
          {parts.map((k, i) => {
            const Icon = CLASS_ICON[k];
            const label = `${CLASSES[k]} ${formatCompact(c.byClass[k], c.currency)}`;
            return (
              <li
                key={k}
                title={label}
                className="flex size-9 items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-slate-900"
                style={{ background: CLASS_COLOR[k], marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
              >
                <Icon size={17} aria-hidden />
                <span className="sr-only">{label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {c.unconverted.length > 0 && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Some amounts have no exchange rate and are left out.
        </p>
      )}
    </Link>
  );
}

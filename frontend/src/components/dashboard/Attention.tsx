import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { useMe } from '../../auth/auth';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { attentionItems } from '../../lib/attention';
import type { HoldingsResponse } from '../../lib/investments';
import { localDay } from '../../lib/months';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

/** What needs a look, each with a link to where it is sorted out; hidden when nothing does. */
export function Attention({
  uncategorised,
}: {
  /** the period's income and payments without a category (null while it loads) */
  uncategorised: { count: number; latestMonth: string | null } | null;
}) {
  const [view] = useViewCurrency();
  const pricesOn = !!useMe().data?.family.livePrices;
  // the same request as the Investments page, so it is shared
  const holdings = useQuery({
    queryKey: ['holdings', view],
    queryFn: () => api.get<HoldingsResponse>(withView('/holdings', view)),
  });
  const items = attentionItems({
    today: localDay(),
    uncategorised,
    holdings: holdings.data?.holdings ?? [],
    pricesOn,
  });
  if (items.length === 0) return null;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <CircleAlert size={18} className="text-amber-600" aria-hidden /> Needs your attention
        </span>
      }
    >
      <ul className="-my-1 divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              to={i.link}
              className="flex items-center justify-between gap-3 py-2 text-sm hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              <span className="min-w-0 break-words">{i.text}</span>
              <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

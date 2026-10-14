import { useQuery } from '@tanstack/react-query';
import { Card } from '../ui/Card';
import { api } from '../../lib/api';
import { useBucketNames } from '../../lib/buckets';
import type { Dashboard } from '../../lib/dashboardTypes';
import { localMonth, shiftMonth } from '../../lib/months';
import { moneyStory, storyMonth, topSpender } from '../../lib/moneyStory';
import { useViewCurrency, withView } from '../../lib/viewCurrency';

/** The latest finished month told as a short story (months in progress are left out). */
export function MoneyStory() {
  const names = useBucketNames();
  const [view] = useViewCurrency();
  const last = shiftMonth(localMonth(), -1);
  const from = shiftMonth(last, -5);
  const history = useQuery({
    queryKey: ['dashboard', from, last, view],
    queryFn: () => api.get<Dashboard>(withView(`/dashboard?from=${from}&to=${last}`, view)),
  });
  const month = history.data ? storyMonth(history.data.months) : null;
  const detail = useQuery({
    queryKey: ['dashboard', month, month, view],
    queryFn: () => api.get<Dashboard>(withView(`/dashboard?from=${month}&to=${month}`, view)),
    enabled: !!month,
  });
  if (!history.data || !detail.data) return null;
  const story = moneyStory({
    months: history.data.months,
    top: topSpender(detail.data.categories),
    names,
    currency: history.data.currency,
    unconverted: detail.data.unconverted,
  });
  if (!story) return null;
  return (
    <Card title={story.title}>
      <ul className="space-y-1.5 text-sm">
        {story.lines.map((l) => (
          <li key={l.icon} className="flex gap-2">
            <span aria-hidden className="w-5 shrink-0 text-center">
              {l.icon}
            </span>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

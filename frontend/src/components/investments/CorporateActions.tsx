import { AlertTriangle, Scissors } from 'lucide-react';
import { Card } from '../ui/Card';
import { actionText, recentActions } from '../../lib/corporateActions';
import type { Holding } from '../../lib/investments';
import { localDay } from '../../lib/months';

/** Splits and bonus issues of the last weeks: what was adjusted, and what to check by hand. */
export function CorporateActions({
  holdings,
  onOpen,
}: {
  holdings: Holding[];
  onOpen: (id: string) => void;
}) {
  const list = recentActions(holdings, localDay());
  if (list.length === 0) return null;
  return (
    <Card title="Splits and bonus issues">
      <ul className="space-y-2 text-sm">
        {list.map(({ holding, action }) => {
          const { text, check } = actionText(holding, action);
          const Icon = check ? AlertTriangle : Scissors;
          return (
            <li key={`${holding.id}|${action.exDate}|${action.purpose}`} className="flex gap-2">
              <Icon
                size={16}
                aria-hidden
                className={
                  check ? 'mt-0.5 shrink-0 text-amber-600' : 'mt-0.5 shrink-0 text-slate-500'
                }
              />
              <span>
                {check && <span className="sr-only">To check: </span>}
                <button
                  type="button"
                  className="font-medium hover:underline"
                  onClick={() => onOpen(holding.id)}
                >
                  {holding.name}
                </button>{' '}
                — {text}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

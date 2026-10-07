import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Insight } from '../../lib/insights';

const ICON = {
  good: { Icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Good' },
  warning: {
    Icon: AlertTriangle,
    className: 'text-amber-600 dark:text-amber-400',
    label: 'Attention',
  },
  info: { Icon: Info, className: 'text-slate-400', label: 'Info' },
} as const;

export function Insights({ items }: { items: Insight[] }) {
  if (items.length === 0) return null;
  return (
    <Card title="Financial insights">
      <ul className="space-y-2">
        {items.map((i) => {
          const { Icon, className, label } = ICON[i.tone];
          return (
            <li key={i.text} className="flex items-start gap-2 text-sm">
              <Icon size={18} className={`mt-0.5 shrink-0 ${className}`} aria-label={label} />
              <span>{i.text}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-400">
        Calculated from your own numbers. Not financial advice.
      </p>
    </Card>
  );
}

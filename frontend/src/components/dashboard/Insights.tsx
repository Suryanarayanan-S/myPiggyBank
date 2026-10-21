import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../ui/Card';
/** A line to show: its tone (icon + word, never colour alone), the sentence and where it comes from. */
export type InsightLine = { tone: 'good' | 'warning' | 'info'; text: string; link?: string };

export const ICON = {
  good: { Icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Good' },
  warning: {
    Icon: AlertTriangle,
    className: 'text-amber-600 dark:text-amber-400',
    label: 'Attention',
  },
  info: { Icon: Info, className: 'text-slate-400', label: 'Info' },
} as const;

export function Insights({
  items,
  more,
  failed,
}: {
  items: InsightLine[];
  more?: boolean;
  /** the observations could not be loaded (the period insights still show) */
  failed?: boolean;
}) {
  if (items.length === 0 && !failed) return null;
  return (
    <Card
      title="Financial insights"
      actions={
        more && (
          <Link to="/reports/insights" className="text-sm text-indigo-600 hover:underline">
            All insights
          </Link>
        )
      }
    >
      <ul className="space-y-2">
        {items.map((i, index) => {
          const { Icon, className, label } = ICON[i.tone];
          return (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Icon size={18} className={`mt-0.5 shrink-0 ${className}`} aria-label={label} />
              <span>
                {i.text}
                {i.link && (
                  <Link to={i.link} className="ml-1 text-indigo-600 hover:underline">
                    See
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Could not load all insights right now.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Calculated from your own numbers. Not financial advice.
      </p>
    </Card>
  );
}

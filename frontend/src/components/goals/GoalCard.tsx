import clsx from 'clsx';
import { AlertTriangle, Pencil, PiggyBank } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { goalStatus, type Goal, type Tone } from '../../lib/goals';
import { formatMoney } from '../../lib/money';

const BADGE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  bad: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const BAR = { good: 'ok', warn: 'warn', bad: 'bad', neutral: 'neutral' } as const;

const monthYear = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function StatusBadge({ goal }: { goal: Goal }) {
  const s = goalStatus(goal.progress);
  return (
    <span className={clsx('rounded px-1.5 py-0.5 text-xs font-medium', BADGE[s.tone])}>
      {s.label}
    </span>
  );
}

export function GoalCard({
  goal,
  owner,
  onEdit,
  onEntries,
}: {
  goal: Goal;
  owner: string;
  onEdit: () => void;
  onEntries: () => void;
}) {
  const p = goal.progress;
  const money = (cents: number) => formatMoney(cents, goal.currency);
  return (
    <Card className={goal.status === 'archived' ? 'opacity-70' : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{goal.name}</h3>
          <p className="text-xs text-slate-500">
            {owner}
            {goal.targetDate && ` · by ${monthYear(goal.targetDate)}`}
          </p>
        </div>
        <span className="flex items-center gap-1">
          <StatusBadge goal={goal} />
          <Button variant="ghost" aria-label={`Edit ${goal.name}`} onClick={onEdit}>
            <Pencil size={16} aria-hidden />
          </Button>
        </span>
      </div>

      <p className="mt-3 text-sm">
        <span className="text-xl font-semibold tabular-nums">{money(goal.saved)}</span>{' '}
        <span className="text-slate-500">
          of {money(goal.targetAmount)} · {Math.floor(p.pctBp / 100)} %
        </span>
      </p>
      <div className="mt-2">
        <Progress
          label={`${goal.name} saved of target`}
          value={p.pctBp / 10_000}
          tone={BAR[goalStatus(p).tone]}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {!p.reached && (
          <>
            <dt className="text-slate-500">Still to save</dt>
            <dd className="text-right font-medium tabular-nums">{money(p.left)}</dd>
          </>
        )}
        {p.monthlyNeeded !== null && !p.reached && (
          <>
            <dt className="text-slate-500">{p.overdue ? 'Needed now' : 'Needed per month'}</dt>
            <dd className="text-right font-medium tabular-nums">{money(p.monthlyNeeded)}</dd>
          </>
        )}
        <dt className="text-slate-500">Last 3 months</dt>
        <dd
          className={clsx(
            'text-right tabular-nums',
            p.pace < 0 && 'text-rose-600 dark:text-rose-400',
          )}
        >
          {p.pace >= 0 ? '+' : ''}
          {money(p.pace)} / month
        </dd>
      </dl>
      {goal.unconverted.length > 0 && (
        <p className="mt-2 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
          Not counted (no exchange rate):{' '}
          {goal.unconverted.map((u) => formatMoney(u.amount, u.currency)).join(', ')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <span className="flex min-w-0 flex-wrap gap-1">
          {goal.links.map((l) => (
            <span
              key={`${l.kind}:${l.id}`}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {l.name} {formatMoney(l.amount, l.currency)}
            </span>
          ))}
          {goal.links.length === 0 && goal.entries.length === 0 && (
            <span className="text-xs text-slate-500">Nothing linked yet</span>
          )}
        </span>
        <Button variant="secondary" className="!py-1" onClick={onEntries}>
          <PiggyBank size={14} aria-hidden /> Entries
          {goal.entries.length > 0 && ` (${goal.entries.length})`}
        </Button>
      </div>
    </Card>
  );
}

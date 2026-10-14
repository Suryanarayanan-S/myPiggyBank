import { Card } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';
import { useBucketNames } from '../../lib/buckets';
import { type MonthSummary } from '../../lib/types';

export function BucketBars({ s, actions }: { s: MonthSummary; actions?: React.ReactNode }) {
  const names = useBucketNames();
  return (
    <Card title="50 / 30 / 20" actions={actions}>
      <div className="space-y-5">
        {s.buckets.map((b) => {
          const diff = Math.abs(b.actual - b.target);
          const hint =
            s.netIncome === 0
              ? 'No income recorded this month yet.'
              : b.status === 'over'
                ? `${formatMoney(diff, s.currency)} over its ${b.targetPct} % target`
                : b.status === 'under'
                  ? `${formatMoney(diff, s.currency)} below its ${b.targetPct} % target`
                  : b.bucket === 'future'
                    ? 'Target reached'
                    : `${formatMoney(diff, s.currency)} left within target`;
          const tone = b.status === 'over' ? 'bad' : b.status === 'under' ? 'warn' : 'ok';
          return (
            <div key={b.bucket}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium">
                  {names[b.bucket]}{' '}
                  <span className="font-normal text-slate-500">· target {b.targetPct} %</span>
                </span>
                <span className="tabular-nums">
                  <span className="font-semibold">{formatPercent(b.actualBp)}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {formatMoney(b.actual, s.currency)} of {formatMoney(b.target, s.currency)}
                  </span>
                </span>
              </div>
              <Progress
                label={`${names[b.bucket]} share of income`}
                value={(b.actualBp ?? 0) / 10_000}
                marker={b.targetPct / 100}
                tone={tone}
              />
              <p
                className={
                  b.status === 'over'
                    ? 'mt-1 text-xs text-rose-600 dark:text-rose-400'
                    : b.status === 'under'
                      ? 'mt-1 text-xs text-amber-600 dark:text-amber-400'
                      : 'mt-1 text-xs text-slate-500'
                }
              >
                {hint}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

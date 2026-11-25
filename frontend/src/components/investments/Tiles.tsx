import clsx from 'clsx';
import { Card } from '../ui/Card';
import { gainClass } from '../../lib/investments';
import { Sparkline } from '../dashboard/Sparkline';

/** A headline number with a label (and a hint under it). */
export function Tile({
  label,
  value,
  hint,
  tone,
  line,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
  /** how it moved, as a small graph under the figure */
  line?: number[];
}) {
  return (
    <Card className="!p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={clsx(
          'mt-1 text-xl font-semibold tabular-nums',
          tone !== undefined && gainClass(tone),
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      {line && (
        <div className="mt-2 min-w-0">
          <Sparkline values={line} height={36} />
        </div>
      )}
    </Card>
  );
}

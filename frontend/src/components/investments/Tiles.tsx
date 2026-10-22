import clsx from 'clsx';
import { Card } from '../ui/Card';
import { gainClass } from '../../lib/investments';
import { formatMoney } from '../../lib/money';
import { formatPercent } from '../../lib/percent';

/** A headline number with a label (and a hint under it). */
export function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
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
    </Card>
  );
}

export /** One quantity split into parts: ranked bars in a single colour, values written out. */
function Shares({
  title,
  currency,
  rows,
}: {
  title: string;
  currency: string;
  rows: { label: string; value: number }[];
}) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return (
    <Card title={title}>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span>{r.label}</span>
              <span className="tabular-nums">
                {formatMoney(r.value, currency)}{' '}
                <span className="text-slate-500">
                  {total > 0 ? formatPercent(Math.round((r.value * 10_000) / total)) : ''}
                </span>
              </span>
            </div>
            <div aria-hidden className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total > 0 ? (r.value / total) * 100 : 0}%`,
                  background: 'var(--c-single)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

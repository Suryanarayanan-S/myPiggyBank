import clsx from 'clsx';
import { PRESETS, type Preset } from '../../lib/periods';

export function PeriodFilter({
  preset,
  custom,
  onChange,
}: {
  preset: Preset;
  custom: { from: string; to: string };
  onChange: (preset: Preset, custom?: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Period"
        className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
      >
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={preset === p.value}
            onClick={() => onChange(p.value, custom)}
            className={clsx(
              'rounded-md px-2.5 py-1 text-sm',
              preset === p.value
                ? 'bg-white font-medium shadow-sm dark:bg-slate-900'
                : 'text-slate-600 dark:text-slate-300',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <span className="flex items-center gap-2 text-sm">
          <input
            aria-label="From month"
            type="month"
            value={custom.from}
            onChange={(e) =>
              e.target.value && onChange('custom', { ...custom, from: e.target.value })
            }
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
          to
          <input
            aria-label="To month"
            type="month"
            value={custom.to}
            onChange={(e) =>
              e.target.value && onChange('custom', { ...custom, to: e.target.value })
            }
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        </span>
      )}
    </div>
  );
}

import clsx from 'clsx';

const tones = {
  neutral: 'bg-indigo-500',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
} as const;

/** Horizontal bar; `value` is a fraction (may exceed 1), `marker` an optional target fraction. */
export function Progress({
  value,
  marker,
  tone = 'neutral',
  label,
}: {
  value: number;
  marker?: number;
  tone?: keyof typeof tones;
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="relative h-2.5 w-full overflow-visible rounded-full bg-slate-100 dark:bg-slate-800"
    >
      <div className={clsx('h-full rounded-full', tones[tone])} style={{ width: `${pct}%` }} />
      {marker !== undefined && (
        <div
          aria-hidden
          className="absolute -top-1 h-4.5 w-0.5 rounded bg-slate-700 dark:bg-slate-300"
          style={{ left: `calc(${Math.min(1, marker) * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}

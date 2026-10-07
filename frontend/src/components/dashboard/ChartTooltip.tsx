/** Tooltip body: value first (strong), series name second, keyed with a short line in the series colour. */
export function ChartTooltip({
  active,
  title,
  rows,
}: {
  active?: boolean;
  title?: string;
  rows: { label: string; value: string; color: string }[];
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {title && <p className="mb-1 font-medium text-slate-500">{title}</p>}
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: r.color }} />
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {r.value}
            </span>
            <span className="text-slate-500">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

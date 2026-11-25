import { useState, type ReactNode } from 'react';
import { Card } from '../ui/Card';

export type LegendItem = { label: string; color: string; shape?: 'box' | 'line' | 'dash' | 'dot' };

/** Card with title, legend, chart and a table view (every chart has one). */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  controls,
  bare = false,
  children,
}: {
  title: string;
  /** without its own frame, as part of another card */
  bare?: boolean;
  subtitle?: string;
  legend?: LegendItem[];
  table: ReactNode;
  /** Shown above the chart and its table alike (e.g. a view switch). */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const toggle = (
    <button
      type="button"
      className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-slate-800"
      aria-pressed={showTable}
      onClick={() => setShowTable(!showTable)}
    >
      {showTable ? 'Show chart' : 'Show table'}
    </button>
  );
  const head = (
    <span>
      {title}
      {subtitle && <span className="block text-xs font-normal text-slate-500">{subtitle}</span>}
    </span>
  );
  const body = (
    <>
      {controls}
      {legend && legend.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={
                  l.shape && l.shape !== 'box' ? 'h-0.5 w-4 rounded' : 'h-2.5 w-2.5 rounded-sm'
                }
                style={{
                  background:
                    l.shape === 'dash'
                      ? `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)`
                      : l.shape === 'dot'
                        ? `repeating-linear-gradient(90deg, ${l.color} 0 2px, transparent 2px 4px)`
                        : l.color,
                }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {showTable ? <div className="max-h-80 overflow-auto">{table}</div> : children}
    </>
  );
  if (bare)
    return (
      <section>
        <header className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">{head}</h2>
          {toggle}
        </header>
        {body}
      </section>
    );
  return (
    <Card title={head} actions={toggle}>
      {body}
    </Card>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-white dark:bg-slate-900">
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={`py-1.5 font-medium text-slate-500 ${i ? 'text-right' : 'text-left'}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={String(r[0])} className="border-t border-slate-100 dark:border-slate-800">
            {r.map((c, i) => (
              <td key={i} className={`py-1.5 ${i ? 'text-right' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

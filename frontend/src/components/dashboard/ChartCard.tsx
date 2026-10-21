import { useState, type ReactNode } from 'react';
import { Card } from '../ui/Card';

export type LegendItem = { label: string; color: string; shape?: 'box' | 'line' };

/** Card with title, legend, chart and a table view (every chart has one). */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  controls,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table: ReactNode;
  /** Shown above the chart and its table alike (e.g. a view switch). */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card
      title={
        <span>
          {title}
          {subtitle && <span className="block text-xs font-normal text-slate-500">{subtitle}</span>}
        </span>
      }
      actions={
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-slate-800"
          aria-pressed={showTable}
          onClick={() => setShowTable(!showTable)}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      }
    >
      {controls}
      {legend && legend.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={l.shape === 'line' ? 'h-0.5 w-4 rounded' : 'h-2.5 w-2.5 rounded-sm'}
                style={{ background: l.color }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      {showTable ? <div className="max-h-80 overflow-auto">{table}</div> : children}
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

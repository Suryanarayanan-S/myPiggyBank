import type { ReactNode } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, ChevronRight, type LucideIcon } from 'lucide-react';

/**
 * A summary that is one big link: a title with ›, a headline figure and whatever explains it.
 * The whole card opens the page it sums up (`opens` names it for screen readers).
 */
export function SummaryCard({
  to,
  title,
  opens,
  className,
  chart,
  children,
}: {
  to: string;
  title: string;
  opens: string;
  className?: string;
  /** a small graph beside the figures (below them on narrow cards) */
  chart?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        'group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:bg-linear-to-b dark:from-white/[0.035] dark:to-transparent dark:hover:border-slate-700 dark:hover:bg-slate-800/60',
        className,
      )}
    >
      <h2 className="flex items-center gap-0.5 text-sm font-medium text-slate-500 dark:text-slate-400">
        {title}
        <ChevronRight
          size={16}
          className="transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
        <span className="sr-only">— open {opens}</span>
      </h2>
      {chart ? (
        // the figures keep their width; the graph takes the rest of the row (like a banking app)
        <div className="grid grid-cols-[auto_minmax(5rem,1fr)] items-center gap-x-4">
          <div className="min-w-0">{children}</div>
          <div className="min-w-0">{chart}</div>
        </div>
      ) : (
        children
      )}
    </Link>
  );
}

/** The headline figure of a summary card. */
export function Headline({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{children}</p>;
}

/** A change under the headline: green up or red down (`upIsGood` false flips the colours). */
export function Trend({
  diff,
  children,
  upIsGood = true,
}: {
  diff: number;
  children: ReactNode;
  upIsGood?: boolean;
}) {
  const Icon = diff >= 0 ? ArrowUpRight : ArrowDownRight;
  const good = diff === 0 || diff > 0 === upIsGood;
  return (
    <p
      className={clsx(
        'mt-1 flex items-center gap-1 text-sm',
        good ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
      )}
    >
      <Icon size={16} className="shrink-0" aria-hidden />
      {children}
    </p>
  );
}

export type Part = { key: string; label: string; Icon: LucideIcon; color: string };

/** What a total is made of, as overlapping round icons (the label and amount on hover). */
export function IconRow({ parts, label }: { parts: Part[]; label: string }) {
  if (parts.length === 0) return null;
  return (
    <ul className="mt-5 flex" aria-label={label}>
      {parts.map((p, i) => (
        <li
          key={p.key}
          title={p.label}
          className="flex size-9 items-center justify-center rounded-full text-white ring-2 ring-white dark:ring-slate-900"
          style={{ background: p.color, marginLeft: i === 0 ? 0 : -8, zIndex: 10 - i }}
        >
          <p.Icon size={17} aria-hidden />
          <span className="sr-only">{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 print:break-inside-avoid print:shadow-none',
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import clsx from 'clsx';

export type SectionTab = { to: string; label: string; end?: boolean };

/** A section with its pages as tabs (links, so each tab has its own address). */
export function SectionLayout({ name, tabs }: { name: string; tabs: SectionTab[] }) {
  return (
    <div className="space-y-5">
      <nav
        aria-label={`${name} pages`}
        className="-mt-1 flex gap-1 overflow-x-auto border-b border-slate-200 print:hidden dark:border-slate-800"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              clsx(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
                isActive
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

/** An old address that moved into a section: keeps its filters (?…). */
export function Moved({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

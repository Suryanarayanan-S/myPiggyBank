import clsx from 'clsx';
import { LogOut, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMe } from '../auth/auth';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import { Brand } from './Brand';
import { CurrencySwitch } from '../components/CurrencySwitch';
import { ThemeToggle } from '../components/ThemeToggle';
import { navItems } from './nav';
import { forgetUserData } from '../lib/session';

export function AppShell() {
  const { data } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      forgetUserData(queryClient);
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 hidden w-60 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <Brand />
          <ThemeToggle compact />
        </div>
        <div className="-mt-2 px-3 pb-3">
          <CurrencySwitch label />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )
              }
            >
              <item.icon size={18} aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <p className="truncate px-2 text-sm font-medium">{data?.user.name}</p>
          <p className="truncate px-2 text-xs text-slate-500">{data?.family.name}</p>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start"
            onClick={() => logout.mutate()}
          >
            <LogOut size={16} aria-hidden /> Log out
          </Button>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden dark:border-slate-800 dark:bg-slate-900">
          <Brand />
          <span className="flex items-center gap-1">
            <CurrencySwitch />
            <ThemeToggle compact />
            <Button variant="ghost" aria-label="Log out" onClick={() => logout.mutate()}>
              <LogOut size={18} aria-hidden />
            </Button>
          </span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      <MobileNav />
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const primary = navItems.filter((i) => i.primary);
  const more = navItems.filter((i) => !i.primary);
  const moreActive = more.some((i) => location.pathname.startsWith(i.to));
  const itemClass = (active: boolean) =>
    clsx(
      'flex flex-col items-center gap-1 py-2 text-xs',
      active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500',
    );
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <ul
            className="absolute right-2 bottom-16 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            role="menu"
          >
            {more.map((item) => (
              <li key={item.to} role="none">
                <NavLink
                  role="menuitem"
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                    )
                  }
                >
                  <item.icon size={18} aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900"
      >
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) => itemClass(isActive)}
          >
            <item.icon size={20} aria-hidden />
            {item.label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen(!open)}
          className={itemClass(open || moreActive)}
        >
          <MoreHorizontal size={20} aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}

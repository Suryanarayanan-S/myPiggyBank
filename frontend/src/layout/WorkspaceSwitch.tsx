import clsx from 'clsx';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
  WORKSPACES,
  lastWorkspace,
  placeIn,
  rememberPlace,
  workspaceOf,
  type Workspace,
} from '../lib/workspace';

/** The workspace of the page shown; the page is remembered as its last place. */
export function useWorkspace(): Workspace {
  const { pathname, search } = useLocation();
  const ws = workspaceOf(pathname, lastWorkspace());
  useEffect(() => rememberPlace(ws, pathname + search), [ws, pathname, search]);
  return ws;
}

/** Each workspace's colour: green for The Pocket, amber for The Treasure. */
export const TONE: Record<Workspace, { active: string; icon: string; tile: string }> = {
  pocket: {
    active: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    icon: 'text-emerald-600 dark:text-emerald-400',
    tile: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/60',
  },
  treasure: {
    active: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    icon: 'text-orange-600 dark:text-orange-400',
    tile: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/60',
  },
};

/**
 * The Pocket and The Treasure: two rows in the side menu (a compact pair in a phone's header);
 * each opens the last page used there.
 */
export function WorkspaceSwitch({ current, compact }: { current: Workspace; compact?: boolean }) {
  return (
    <nav
      aria-label="Workspaces"
      className={clsx('grid', compact ? 'grid-cols-2 gap-1' : 'gap-1.5')}
    >
      {(['pocket', 'treasure'] as const).map((ws) => {
        const w = WORKSPACES[ws];
        const on = ws === current;
        return (
          <Link
            key={ws}
            to={on ? w.home : placeIn(ws)}
            aria-current={on ? 'true' : undefined}
            aria-label={`${w.name}: ${w.note}`}
            className={clsx(
              'rounded-xl border transition-colors',
              'flex items-center',
              compact ? 'gap-1 px-1.5 py-1.5' : 'gap-3 px-3 py-2',
              on
                ? TONE[ws].tile
                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
            )}
          >
            <w.icon
              size={compact ? 16 : 20}
              strokeWidth={2.25}
              className={clsx('shrink-0', TONE[ws].icon)}
              aria-hidden
            />
            {compact ? (
              // very narrow phones: the icons alone (the name stays for screen readers)
              <span className="text-xs font-medium max-[380px]:sr-only">{w.short}</span>
            ) : (
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{w.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{w.note}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

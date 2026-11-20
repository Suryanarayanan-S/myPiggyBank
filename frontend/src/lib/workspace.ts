import { Gem, Wallet, type LucideIcon } from 'lucide-react';

/**
 * Two workspaces in one app: The Pocket for everyday money, The Treasure for the portfolio and
 * wealth. Same login and data; each has its own menu.
 */
export type Workspace = 'pocket' | 'treasure';

export const WORKSPACES: Record<
  Workspace,
  { name: string; short: string; note: string; home: string; icon: LucideIcon }
> = {
  pocket: { name: 'The Pocket', short: 'Pocket', note: 'Everyday money', home: '/', icon: Wallet },
  treasure: {
    name: 'The Treasure',
    short: 'Treasure',
    note: 'Portfolio & wealth',
    home: '/investments',
    icon: Gem,
  },
};

const TREASURE = ['/investments', '/wealth', '/analytics'];
/** Pages in both (Settings): they stay in the workspace you came from. */
const SHARED = ['/settings'];

/**
 * Old addresses that only redirect (see App.tsx): they belong where they lead, and are never
 * remembered as a last page.
 */
export const MOVED: Record<string, string> = {
  '/accounts': '/transactions/accounts',
  '/wealth/accounts': '/transactions/accounts',
  '/recurring': '/transactions/recurring',
  '/import': '/transactions/import',
  '/spending/transactions': '/transactions',
  '/spending/recurring': '/transactions/recurring',
  '/spending/import': '/transactions/import',
  '/goals': '/wealth/goals',
  '/budget': '/spending/budget',
  '/budget/overview': '/spending',
  '/budget/entry': '/spending/entry',
  '/insights': '/reports/insights',
  '/investments/deposits/recurring': '/investments/deposits',
  '/investments/deposits/savings': '/investments/deposits',
};

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function workspaceOf(path: string, current: Workspace): Workspace {
  const p = MOVED[path] ?? path;
  if (SHARED.some((b) => under(p, b))) return current;
  return TREASURE.some((b) => under(p, b)) ? 'treasure' : 'pocket';
}

const KEY = 'pb-workspace';
/** The workspace last used, and the last page in each (a per-browser convenience). */
export function lastWorkspace(): Workspace {
  try {
    return localStorage.getItem(KEY) === 'treasure' ? 'treasure' : 'pocket';
  } catch {
    return 'pocket';
  }
}
export function rememberPlace(ws: Workspace, path: string) {
  try {
    localStorage.setItem(KEY, ws);
    const page = path.split('?')[0]!;
    if (!SHARED.some((b) => under(page, b)) && !MOVED[page]) {
      localStorage.setItem(`${KEY}-${ws}`, path);
    }
  } catch {
    // private window or blocked storage: switching just goes to the workspace's home
  }
}
/** Forgets the places (at logout: another person may use this browser next). */
export function forgetPlaces() {
  try {
    for (const k of [KEY, `${KEY}-pocket`, `${KEY}-treasure`]) localStorage.removeItem(k);
  } catch {
    // nothing stored
  }
}

/** Where switching to `ws` goes: the last page there, else its home. */
export function placeIn(ws: Workspace): string {
  try {
    const p = localStorage.getItem(`${KEY}-${ws}`);
    // a path of this app (never "//elsewhere"), still in that workspace
    if (p && /^\/(?![/\\])/.test(p) && workspaceOf(p.split('?')[0]!, ws) === ws) return p;
  } catch {
    // fall through
  }
  return WORKSPACES[ws].home;
}

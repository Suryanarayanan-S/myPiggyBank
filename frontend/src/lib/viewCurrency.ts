import { useSyncExternalStore } from 'react';
import { CURRENCIES, type Currency } from './types';

/** "default" = each page's own currency (spending or wealth); otherwise one currency everywhere. */
export type View = 'default' | Currency;
export const VIEW_KEY = 'pb-view-currency';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

export function readView(store: Store | undefined = browserStore()): View {
  try {
    const v = store?.getItem(VIEW_KEY);
    return (CURRENCIES as readonly string[]).includes(v ?? '') ? (v as Currency) : 'default';
  } catch {
    return 'default';
  }
}

export function saveView(view: View, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(VIEW_KEY, view);
  } catch {
    // Storage may be blocked; the choice still applies for this visit.
  }
}

/** Appends `currency=` to an API path when a currency was chosen. */
export const withView = (path: string, view: View) =>
  view === 'default' ? path : `${path}${path.includes('?') ? '&' : '?'}currency=${view}`;

/**
 * The choice for this visit, kept in one place (also when storage is blocked), so a component
 * that appears just as the choice changes never misses it.
 */
let current: View | null = null;
const listeners = new Set<() => void>();
const snapshot = () => (current ??= readView());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function choose(next: View) {
  saveView(next);
  current = next;
  listeners.forEach((fn) => fn());
}
export const viewStore = { get: snapshot, set: choose, subscribe };
/** The chosen view currency, shared by every switch and page on this browser. */
export function useViewCurrency(): [View, (v: View) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => 'default' as View), choose];
}

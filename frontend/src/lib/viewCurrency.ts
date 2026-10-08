import { useCallback, useEffect, useState } from 'react';
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

/** The chosen view currency, shared by every switch and page on this browser. */
export function useViewCurrency(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => readView());
  const choose = useCallback((next: View) => {
    saveView(next);
    setView(next);
    window.dispatchEvent(new CustomEvent('pb-view-currency', { detail: next }));
  }, []);
  useEffect(() => {
    const onChange = (e: Event) => setView((e as CustomEvent<View>).detail);
    window.addEventListener('pb-view-currency', onChange);
    return () => window.removeEventListener('pb-view-currency', onChange);
  }, []);
  return [view, choose];
}

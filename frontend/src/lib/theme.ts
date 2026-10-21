import { useCallback, useEffect, useState } from 'react';

/** Light or dark: chosen, or following the computer's setting. */
export type ModePref = 'system' | 'light' | 'dark';
export type Mode = 'light' | 'dark';
export const MODE_KEY = 'pb-mode';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/** The saved light/dark choice; "system" when nothing is saved or storage is unavailable. */
export function readModePref(store: Store | undefined = browserStore()): ModePref {
  try {
    const v = store?.getItem(MODE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}
export function saveModePref(pref: ModePref, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(MODE_KEY, pref);
  } catch {
    // Private windows may refuse storage; the choice still applies for this visit.
  }
}

/** Light or dark on screen: the choice, or the computer's setting. */
export const modeFor = (pref: ModePref, prefersDark: boolean): Mode =>
  pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;

/** One button cycles through the three choices. */
export const nextModePref = (pref: ModePref): ModePref =>
  pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';

export function applyMode(mode: Mode, root: Root = document.documentElement) {
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
const EVENT = 'pb-theme';

/**
 * The light/dark choice, kept on the page and in step across every control (sidebar, mobile
 * header, login page, Settings) and with the computer's dark mode.
 */
export function useTheme() {
  const [pref, setPref] = useState<ModePref>(() => readModePref());
  useEffect(() => {
    const q = darkQuery();
    const sync = () => applyMode(modeFor(pref, q.matches));
    sync();
    q.addEventListener('change', sync);
    // Paper is white: print in the light colours even when the screen is dark.
    const toLight = () => applyMode('light');
    window.addEventListener('beforeprint', toLight);
    window.addEventListener('afterprint', sync);
    return () => {
      q.removeEventListener('change', sync);
      window.removeEventListener('beforeprint', toLight);
      window.removeEventListener('afterprint', sync);
    };
  }, [pref]);
  useEffect(() => {
    const onChange = () => setPref(readModePref());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const chooseMode = useCallback((next: ModePref) => {
    saveModePref(next);
    setPref(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { pref, chooseMode };
}

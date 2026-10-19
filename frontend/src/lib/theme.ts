import { useCallback, useEffect, useState } from 'react';

export type Look = 'modern' | 'retro';
/** Light or dark: chosen, or following the computer's setting. */
export type ModePref = 'system' | 'light' | 'dark';
export type Mode = 'light' | 'dark';
export const LOOK_KEY = 'pb-look';
export const MODE_KEY = 'pb-mode';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

function read<T extends string>(key: string, allowed: readonly T[], fallback: T, store?: Store): T {
  try {
    const v = store?.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string, store?: Store) {
  try {
    store?.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice still applies for this visit.
  }
}

/** The saved look; "modern" when nothing is saved or storage is unavailable. */
export const readLook = (store: Store | undefined = browserStore()): Look =>
  read(LOOK_KEY, ['modern', 'retro'] as const, 'modern', store);
export const saveLook = (look: Look, store: Store | undefined = browserStore()) =>
  save(LOOK_KEY, look, store);

/** The saved light/dark choice; "system" when nothing is saved. */
export const readModePref = (store: Store | undefined = browserStore()): ModePref =>
  read(MODE_KEY, ['system', 'light', 'dark'] as const, 'system', store);
export const saveModePref = (pref: ModePref, store: Store | undefined = browserStore()) =>
  save(MODE_KEY, pref, store);

/** Light or dark on screen: the choice, or the computer's setting (same for both looks). */
export const modeFor = (pref: ModePref, prefersDark: boolean): Mode =>
  pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;

/** One button cycles through the three choices. */
export const nextModePref = (pref: ModePref): ModePref =>
  pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';

export function applyLook(look: Look, mode: Mode, root: Root = document.documentElement) {
  root.dataset.style = look;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
const EVENT = 'pb-theme';

/**
 * Look and light/dark choice, kept on the page and in step across every control (sidebar,
 * mobile header, login page, Settings) and with the computer's dark mode.
 */
export function useTheme() {
  const [look, setLook] = useState<Look>(() => readLook());
  const [pref, setPref] = useState<ModePref>(() => readModePref());
  useEffect(() => {
    const q = darkQuery();
    const sync = () => applyLook(look, modeFor(pref, q.matches));
    sync();
    q.addEventListener('change', sync);
    // Paper is white: print in the light colours even when the screen is dark.
    const toLight = () => applyLook(look, 'light');
    window.addEventListener('beforeprint', toLight);
    window.addEventListener('afterprint', sync);
    return () => {
      q.removeEventListener('change', sync);
      window.removeEventListener('beforeprint', toLight);
      window.removeEventListener('afterprint', sync);
    };
  }, [look, pref]);
  useEffect(() => {
    const onChange = () => {
      setLook(readLook());
      setPref(readModePref());
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const announce = () => window.dispatchEvent(new Event(EVENT));
  const chooseLook = useCallback((next: Look) => {
    saveLook(next);
    setLook(next);
    announce();
  }, []);
  const chooseMode = useCallback((next: ModePref) => {
    saveModePref(next);
    setPref(next);
    announce();
  }, []);
  return { look, pref, chooseLook, chooseMode };
}

/** Current look plus a one-click toggle between modern and retro. */
export function useLook(): [Look, () => void] {
  const { look, chooseLook } = useTheme();
  const toggle = useCallback(
    () => chooseLook(look === 'modern' ? 'retro' : 'modern'),
    [look, chooseLook],
  );
  return [look, toggle];
}

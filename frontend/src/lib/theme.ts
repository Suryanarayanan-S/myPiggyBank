import { useCallback, useEffect, useState } from 'react';

export type Look = 'modern' | 'retro';
export const LOOK_KEY = 'pb-look';
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/** The saved look; "modern" when nothing is saved or storage is unavailable. */
export function readLook(store: Store | undefined = browserStore()): Look {
  try {
    return store?.getItem(LOOK_KEY) === 'retro' ? 'retro' : 'modern';
  } catch {
    return 'modern';
  }
}

export function saveLook(look: Look, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(LOOK_KEY, look);
  } catch {
    // Private windows may refuse storage; the look still applies for this visit.
  }
}

/** Modern follows the system light/dark setting; retro is one fixed arcade palette. */
export const modeFor = (look: Look, prefersDark: boolean) =>
  look === 'modern' && prefersDark ? 'dark' : 'light';

export function applyLook(look: Look, prefersDark: boolean, root: Root = document.documentElement) {
  const mode = modeFor(look, prefersDark);
  root.dataset.style = look;
  root.dataset.mode = mode;
  root.style.colorScheme = mode;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Current look plus a one-click toggle; keeps the page in sync with the system dark mode. */
export function useLook(): [Look, () => void] {
  const [look, setLook] = useState<Look>(() => readLook());
  useEffect(() => {
    const q = darkQuery();
    const sync = () => applyLook(look, q.matches);
    sync();
    q.addEventListener('change', sync);
    // Paper is white: print in the light colours even when the screen is dark.
    const toLight = () => applyLook(look, false);
    window.addEventListener('beforeprint', toLight);
    window.addEventListener('afterprint', sync);
    return () => {
      q.removeEventListener('change', sync);
      window.removeEventListener('beforeprint', toLight);
      window.removeEventListener('afterprint', sync);
    };
  }, [look]);
  const toggle = useCallback(() => {
    const next: Look = look === 'modern' ? 'retro' : 'modern';
    saveLook(next);
    setLook(next);
    window.dispatchEvent(new CustomEvent('pb-look', { detail: next }));
  }, [look]);
  useEffect(() => {
    // Keep several toggles (sidebar, mobile header, login page) in agreement.
    const onChange = (e: Event) => setLook((e as CustomEvent<Look>).detail);
    window.addEventListener('pb-look', onChange);
    return () => window.removeEventListener('pb-look', onChange);
  }, []);
  return [look, toggle];
}

import { useCallback, useState } from 'react';

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const browserStore = (): Store | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

/** A saved choice, if it is one of `allowed`; `fallback` otherwise or without storage. */
export function readChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  store: Store | undefined = browserStore(),
): T {
  try {
    const v = store?.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveChoice(key: string, value: string, store: Store | undefined = browserStore()) {
  try {
    store?.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice still applies for this visit.
  }
}

/** A small view choice (a switch's position), remembered on this browser. */
export function useRemembered<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readChoice(key, allowed, fallback));
  const choose = useCallback(
    (next: T) => {
      setValue(next);
      saveChoice(key, next);
    },
    [key],
  );
  return [value, choose];
}

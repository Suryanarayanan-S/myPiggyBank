/**
 * The markets holdings are compared with, by the holdings' currency: Indian ones with Nifty 50
 * and gold, euro ones with ETFs bought in euros and gold in euros.
 */
import { useSyncExternalStore } from 'react';
import type { Holding } from './investments';

export type MarketKey =
  | 'nifty50'
  | 'gold22k'
  | 'gold24k'
  | 'gold'
  | 'goldUsd'
  | 'msciWorld'
  | 'sp500'
  | 'nasdaq100'
  | 'stoxx600'
  | 'nikkei225'
  | 'goldEur';

/** "Value over time": % since a start (the world gold price in dollars fits any currency). */
export const VALUE_MARKETS: Record<string, MarketKey[]> = {
  INR: ['nifty50', 'gold22k', 'gold24k', 'gold', 'goldUsd'],
  EUR: ['msciWorld', 'sp500', 'nasdaq100', 'stoxx600', 'nikkei225', 'goldEur'],
};
/** "The same money elsewhere": bought in the holdings' own currency. */
export const SAME_MONEY_MARKETS: Record<string, MarketKey[]> = {
  INR: ['nifty50', 'gold', 'gold24k', 'gold22k'],
  EUR: ['msciWorld', 'sp500', 'nasdaq100', 'stoxx600', 'nikkei225', 'goldEur'],
};

/** Currencies of the open holdings that have markets to compare with, most holdings first. */
export function compareCurrencies(holdings: Holding[]): string[] {
  const count = new Map<string, number>();
  for (const h of holdings) {
    if (h.archived || !VALUE_MARKETS[h.currency]) continue;
    count.set(h.currency, (count.get(h.currency) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

const KEY = 'pb-compare-currency';
function read() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
// one choice for both comparison cards: switching in one switches the other
let chosen: string | null = read();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Which holdings the comparison cards compare (one currency at a time): the one chosen on this
 * browser while there are holdings in it, else the one with the most.
 */
export function useCompareCurrency(holdings: Holding[]) {
  const options = compareCurrencies(holdings);
  const pick = useSyncExternalStore(subscribe, () => chosen);
  const currency = pick && options.includes(pick) ? pick : (options[0] ?? 'INR');
  const choose = (c: string) => {
    chosen = c;
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // storage refused: the choice still applies for this visit
    }
    listeners.forEach((fn) => fn());
  };
  return { currency, options, choose };
}

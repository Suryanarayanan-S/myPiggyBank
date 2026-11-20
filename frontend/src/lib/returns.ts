import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useViewCurrency, withView } from './viewCurrency';

export type ReturnPart = 'market' | 'fd' | 'rd' | 'savings' | 'gold';

/** One kind of investment (or all together) on one yardstick; amounts in minor units. */
export type ReturnSummary = {
  putIn: number;
  /** money taken back out: sales, withdrawals, deposits paid out */
  takenOut: number;
  /** earned on top and paid out: dividends, interest paid out */
  income: number;
  worth: number;
  gain: number;
  /** the gain over the most money in at any one time */
  gainBp: number | null;
  /** the yearly rate (XIRR), basis points; null when held under three months or no answer */
  xirrBp: number | null;
  /** held under three months: too short for a yearly rate */
  short: boolean;
  since: string | null;
};

/** One payment behind "Back out" or "Dividends & interest" (amount in the view currency). */
export type ReturnLine = {
  date: string;
  name: string;
  income: boolean;
  amount: number;
  /** in its own currency, when that differs */
  own: { amount: number; currency: string } | null;
};

export type ReturnsResponse = {
  currency: string;
  parts: (ReturnSummary & { part: ReturnPart; count: number; lines: ReturnLine[] })[];
  total: ReturnSummary | null;
  leftOut: { market: number; gold: number };
  unconverted: { currency: string; amount: number }[];
};

export const PART_LABEL: Record<ReturnPart, string> = {
  market: 'Market (shares, funds, ETFs)',
  fd: 'Fixed deposits',
  rd: 'Recurring deposits',
  savings: 'Instant-access savings',
  gold: 'Gold (jewellery, coins)',
};

export function useReturns() {
  const [view] = useViewCurrency();
  return useQuery({
    queryKey: ['investment-returns', view],
    queryFn: () => api.get<ReturnsResponse>(withView('/investments/returns', view)),
  });
}

/** "+7.2 %", "−3.0 %", "0.0 %"; null → "—". */
export const signedPercent = (bp: number | null) =>
  bp === null ? '—' : `${bp > 0 ? '+' : bp < 0 ? '−' : ''}${(Math.abs(bp) / 100).toFixed(1)} %`;

/** What was left out of the returns, in words (empty: nothing). */
export function leftOutNotes(r: Pick<ReturnsResponse, 'leftOut'>): string[] {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    r.leftOut.market > 0 && `${n(r.leftOut.market, 'holding', 'holdings')} without a price yet`,
    r.leftOut.gold > 0 &&
      `${n(r.leftOut.gold, 'piece', 'pieces')} of gold without the price paid or the day bought (or no gold rate yet)`,
  ].filter((s): s is string => !!s);
}

/** Totals per holding or deposit, largest first (who the money came from). */
export function byName(lines: ReturnLine[]): { name: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>();
  for (const l of lines) {
    const t = m.get(l.name) ?? { amount: 0, count: 0 };
    m.set(l.name, { amount: t.amount + l.amount, count: t.count + 1 });
  }
  return [...m]
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

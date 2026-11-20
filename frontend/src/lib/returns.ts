import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useViewCurrency, withView } from './viewCurrency';

export type ReturnPart = 'market' | 'fd' | 'rd' | 'savings' | 'gold';

/** One kind of investment (or all together) on one yardstick; amounts in minor units. */
export type ReturnSummary = {
  putIn: number;
  takenOut: number;
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

export type ReturnsResponse = {
  currency: string;
  parts: (ReturnSummary & { part: ReturnPart; count: number })[];
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

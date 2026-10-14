export const HOLDING_KINDS = {
  stock: 'Stock',
  etf: 'ETF',
  fund: 'Mutual fund',
  gold: 'Gold',
  other: 'Other',
} as const;
export type HoldingKind = keyof typeof HOLDING_KINDS;

export type HoldingTrade = {
  id: string;
  date: string;
  type: 'buy' | 'sell' | 'dividend';
  /** decimal string, null for dividends */
  units: string | null;
  amount: number;
  fees: number;
};
export type Holding = {
  id: string;
  name: string;
  kind: HoldingKind;
  symbol: string | null;
  currency: string;
  ownerMemberId: string | null;
  accountId: string | null;
  note: string | null;
  archived: boolean;
  units: string;
  avgCost: string | null;
  price: string | null;
  priceDate: string | null;
  priceSource: 'price' | 'trade' | null;
  cost: number;
  value: number | null;
  unrealised: number | null;
  returnBp: number | null;
  realised: number;
  realisedBp: number | null;
  dividends: number;
  trades: HoldingTrade[];
  prices: { id: string; date: string; price: string }[];
};
export type HoldingsResponse = {
  holdings: Holding[];
  summary: {
    currency: string;
    value: number;
    invested: number;
    unrealised: number;
    realised: number;
    dividends: number;
    byKind: { kind: HoldingKind; value: number }[];
    byMember: { memberId: string | null; name: string; value: number }[];
    unconverted: { currency: string; amount: number }[];
  };
};

/** "12,5" / "98.4567" → "12.5" / "98.4567" for the API; null unless a positive number with
 *  at most 6 decimals (no thousands separators, so "1.234" is never ambiguous). */
export function normaliseDecimal(input: string): string | null {
  const s = input.trim();
  if (!/^\d+([.,]\d{1,6})?$/.test(s)) return null;
  const n = s.replace(',', '.');
  return Number(n) > 0 ? n : null;
}

/** A decimal string as German-style number with only the decimals needed. */
export const formatUnits = (units: string) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6 }).format(Number(units));

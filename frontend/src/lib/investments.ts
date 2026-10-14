import { formatMoney, localeFor } from './money';

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
  /** Value and cost in the summary currency; null without an exchange rate. */
  inView: { value: number; cost: number } | null;
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
export const formatUnits = (units: string, currency = 'EUR') =>
  new Intl.NumberFormat(localeFor(currency), { maximumFractionDigits: 6 }).format(Number(units));

/** A price or average cost for lists, to the cent like a broker shows it (exact in the trades). */
export const formatPrice = (price: string, currency: string) =>
  new Intl.NumberFormat(localeFor(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(price));

/** "+₹1,234.00" / "−€5.00" for gains and losses. */
export const signed = (cents: number, currency: string) =>
  `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${formatMoney(Math.abs(cents), currency)}`;
/** Green for a gain, red for a loss, plain for none. */
export const gainClass = (n: number | null) =>
  n === null || n === 0
    ? 'text-slate-600 dark:text-slate-300'
    : n > 0
      ? 'text-emerald-700 dark:text-emerald-400'
      : 'text-rose-700 dark:text-rose-400';

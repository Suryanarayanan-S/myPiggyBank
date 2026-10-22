import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useViewCurrency, withView } from './viewCurrency';

export const PURITY = {
  '24k': '24K (999)',
  '22k': '22K (916)',
  '18k': '18K (750)',
  '14k': '14K (585)',
} as const;
export type Purity = keyof typeof PURITY;

export type GoldItem = {
  id: string;
  name: string;
  ownerMemberId: string | null;
  /** grams, e.g. "12.5" */
  grams: string;
  purity: Purity;
  boughtOn: string | null;
  boughtFor: number | null;
  closedAt: string | null;
  note: string | null;
  currency: 'INR';
  /** worth today at the latest IBJA rate; null without a rate or once no longer held */
  value: number | null;
  gain: number | null;
  status: 'held' | 'closed';
};
export type GoldResponse = {
  items: GoldItem[];
  /** the IBJA rate for 999 gold used (₹ per gram), null before any was collected */
  rate: { date: string; perGram24k: number; stale: boolean } | null;
  summary: {
    currency: string;
    value: number;
    unconverted: { currency: string; amount: number }[];
    grams: string;
  };
};

/** The family's physical gold, totals in the "Show in" currency. */
export function useGold() {
  const [view] = useViewCurrency();
  return useQuery({
    queryKey: ['gold', view],
    queryFn: () => api.get<GoldResponse>(withView('/gold', view)),
  });
}

/** "12.5" / "12,5" grams (up to 3 decimals) → the API's "12.5"; null unless above zero. */
export function normaliseGrams(input: string): string | null {
  const s = input.trim().replace(/\s*g$/i, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(s) || Number(s) <= 0) return null;
  return s;
}

/** 12.5 g, written like the family's numbers. */
export const formatGrams = (grams: string, locale = 'en-IN') =>
  `${Number(grams).toLocaleString(locale, { maximumFractionDigits: 3 })} g`;

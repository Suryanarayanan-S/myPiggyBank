import { z } from 'zod';

export const CURRENCIES = ['EUR', 'INR', 'USD', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CurrencySchema = z.enum(CURRENCIES, 'Unsupported currency');

const MICROS = 1_000_000;

/** "97.85" or "97,85" → 97_850_000 micros. Positive, at most 6 decimals; otherwise null. */
export function parseRate(input: string): number | null {
  const match = input.trim().match(/^(\d+)(?:[.,](\d{1,6}))?$/);
  if (!match) return null;
  const micros = Number(match[1]) * MICROS + Number((match[2] ?? '').padEnd(6, '0'));
  return micros > 0 && Number.isSafeInteger(micros) ? micros : null;
}

export function formatRate(micros: number): string {
  const whole = Math.floor(micros / MICROS);
  const frac = String(micros % MICROS)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export type Rate = { month: string; base: string; quote: string; rateMicros: number };

/**
 * Micros of `to` per 1 `from` for `month`: the exact month, else the latest earlier month.
 * A stored reverse pair is inverted. Null when nothing applies.
 */
export function findRate(rates: Rate[], month: string, from: string, to: string): number | null {
  if (from === to) return MICROS;
  let best: { month: string; micros: number } | null = null;
  for (const r of rates) {
    if (r.month > month) continue;
    let micros: number | null = null;
    if (r.base === from && r.quote === to) micros = r.rateMicros;
    else if (r.base === to && r.quote === from)
      micros = Math.round((MICROS * MICROS) / r.rateMicros);
    if (micros !== null && (!best || r.month > best.month)) best = { month: r.month, micros };
  }
  return best?.micros ?? null;
}

/** Converts minor units, rounding half away from zero. Null when no rate is available. */
export function convert(
  cents: number,
  from: string,
  to: string,
  month: string,
  rates: Rate[],
): number | null {
  const micros = findRate(rates, month, from, to);
  if (micros === null) return null;
  const abs = (BigInt(Math.abs(cents)) * BigInt(micros) + BigInt(MICROS / 2)) / BigInt(MICROS);
  return Number(abs) * (cents < 0 ? -1 : 1);
}

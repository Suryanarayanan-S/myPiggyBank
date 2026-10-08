import { z } from 'zod';

// All in the ECB reference set (live rates) and all with 2 decimals (minor units = cents).
export const CURRENCIES = ['EUR', 'INR', 'USD', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CurrencySchema = z.enum(CURRENCIES, 'Unsupported currency');
/** `?currency=` on read endpoints: show the money in this currency instead of the default. */
export const ViewQuery = z.object({ currency: CurrencySchema.optional() });

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
    if (r.month > month || !(r.rateMicros > 0) || !Number.isFinite(r.rateMicros)) continue;
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

/** A live reference rate: 1 EUR = rateMicros / 1e6 `quote`, for `month`. */
export type LiveRate = { month: string; quote: string; rateMicros: number };

/** Live EUR → X rates as every pair among the published currencies (cross rates via EUR). */
export function expandLiveRates(live: LiveRate[]): Rate[] {
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of live) {
    const m = byMonth.get(r.month) ?? new Map([['EUR', MICROS]]);
    m.set(r.quote, r.rateMicros);
    byMonth.set(r.month, m);
  }
  const out: Rate[] = [];
  for (const [month, m] of byMonth) {
    const codes = [...m.keys()].filter((c) => m.get(c)! > 0); // a zero rate cannot be divided by
    for (const base of codes) {
      for (const quote of codes) {
        // One direction per pair is enough: findRate inverts. EUR-based pairs stay exact.
        if (base === quote || (base !== 'EUR' && (quote === 'EUR' || base > quote))) continue;
        const rateMicros = Math.round((m.get(quote)! * MICROS) / m.get(base)!);
        if (rateMicros > 0 && Number.isFinite(rateMicros)) {
          out.push({ month, base, quote, rateMicros });
        }
      }
    }
  }
  return out;
}

/**
 * A hand-entered EUR rate replaces the live EUR rate of its month before cross rates are built,
 * so e.g. USD→INR agrees with the user's own EUR→INR for that month.
 */
export function applyManualToLive(live: LiveRate[], manual: Rate[]): LiveRate[] {
  const out = new Map(live.map((r) => [`${r.month}|${r.quote}`, r]));
  const months = new Set(live.map((r) => r.month));
  for (const r of manual) {
    if (!months.has(r.month) || !(r.rateMicros > 0)) continue;
    if (r.base === 'EUR') out.set(`${r.month}|${r.quote}`, { ...r, quote: r.quote });
    else if (r.quote === 'EUR') {
      const rateMicros = Math.round((MICROS * MICROS) / r.rateMicros);
      out.set(`${r.month}|${r.base}`, { month: r.month, quote: r.base, rateMicros });
    }
  }
  return [...out.values()].map(({ month, quote, rateMicros }) => ({ month, quote, rateMicros }));
}

/** Hand-entered rates win over live ones for the same month and currency pair. */
export function mergeRates(manual: Rate[], live: Rate[]): Rate[] {
  const pair = (r: Rate) => `${r.month}|${[r.base, r.quote].sort().join('|')}`;
  const taken = new Set(manual.map(pair));
  return [...manual, ...live.filter((r) => !taken.has(pair(r)))];
}

/** Sum in `to`; amounts without a rate are listed per currency instead of being added 1:1. */
export function sumConverted(
  items: { amount: number; currency: string; month: string }[],
  to: string,
  rates: Rate[],
) {
  let total = 0;
  const unconverted = new Map<string, number>();
  for (const i of items) {
    const v = convert(i.amount, i.currency, to, i.month, rates);
    if (v === null) unconverted.set(i.currency, (unconverted.get(i.currency) ?? 0) + i.amount);
    else total += v;
  }
  return {
    total,
    unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount })),
  };
}

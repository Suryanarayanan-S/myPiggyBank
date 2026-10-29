/**
 * onvista's public JSON (what onvista.de's pages read): an ISIN's instrument, the venues quoting
 * it with their currencies, its splits, and daily closes. Pure: the service fetches.
 */
export type OnvistaInstrument = { entityType: string; entityValue: string; name: string };
export type OnvistaQuote = { idNotation: string; venue: string; currency: string };
export type OnvistaSplit = { date: string; factor: number };

/** Venues by preference: where a German broker's (and Trade Republic's) prices come from. */
const VENUES = ['GAT', 'LSX', 'TRO', 'GER', 'FRA', 'MUN', 'STU', 'BER', 'DUS', 'HAM'];

const json = (text: string) => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('onvista sent something that is not JSON');
  }
};
const BERLIN = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' });
const day = (iso: unknown) => (typeof iso === 'string' ? iso.slice(0, 10) : null);

/** The instrument of exactly this ISIN, if onvista knows it. */
export function readSearch(text: string, isin: string): OnvistaInstrument | null {
  const facets = (json(text).facets ?? []) as { results?: Record<string, unknown>[] | null }[];
  for (const f of facets ?? []) {
    for (const r of f.results ?? []) {
      if (r.isin === isin && typeof r.entityType === 'string' && r.entityValue != null) {
        return {
          entityType: r.entityType,
          entityValue: String(r.entityValue),
          name: typeof r.name === 'string' ? r.name : isin,
        };
      }
    }
  }
  return null;
}

/** The venue to take closes from in `currency`, and the splits onvista lists. */
export function readSnapshot(
  text: string,
  currency: string,
): { quote: OnvistaQuote | null; splits: OnvistaSplit[] } {
  const d = json(text);
  type Q = {
    market?: { name?: string; codeExchange?: string; idNotation?: number | string };
    isoCurrency?: string;
  };
  const quotes = (((d.quoteList as { list?: Q[] } | undefined)?.list ?? []) as Q[]).filter(
    (q) => q.isoCurrency === currency && q.market?.idNotation != null,
  );
  const rank = (q: Q) => {
    const i = VENUES.indexOf(q.market?.codeExchange ?? '');
    return i < 0 ? VENUES.length : i;
  };
  const best = [...quotes].sort((a, b) => rank(a) - rank(b))[0];
  type S = { dateSplit?: string; factor?: number };
  const splits = (((d.stocksSplitList as { list?: S[] } | undefined)?.list ?? []) as S[])
    .map((s) => ({ date: day(s.dateSplit), factor: Number(s.factor) }))
    .filter((s): s is OnvistaSplit => s.date !== null && s.factor > 0 && s.factor !== 1)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    quote: best
      ? {
          idNotation: String(best.market!.idNotation),
          venue: best.market?.name ?? best.market?.codeExchange ?? '',
          currency,
        }
      : null,
    splits,
  };
}

/** Daily closes in micros, oldest first (onvista stamps each day at noon UTC). */
export function readEod(text: string): { date: string; close: number }[] {
  const d = json(text);
  const times = (d.datetimeLast ?? []) as number[];
  const last = (d.last ?? []) as number[];
  return times
    .map((t, i) => ({
      // the trading day in Germany, where the venues are (whatever hour onvista stamps)
      date: BERLIN.format(new Date(t * 1000)),
      close: Math.round((last[i] ?? NaN) * 1_000_000),
    }))
    .filter((p) => Number.isFinite(p.close) && p.close > 0);
}

/**
 * A split's factor (5 = one share became five) as small whole numbers: 1.5 → 3 for 2, and
 * 3.000003 (as onvista lists Honda's) → 3 for 1. A factor that is no such ratio (1.0407 — a
 * spin-off's price adjustment) is no split: null.
 */
export function splitRatio(factor: number): { num: number; den: number } | null {
  if (!(factor > 0)) return null;
  const near = (a: number, b: number) => Math.abs(a - b) / b < 1e-4;
  // a reverse split: some shares became one (1 for 10)
  if (factor < 1) {
    const den = Math.round(1 / factor);
    return den > 1 && near(1 / factor, den) ? { num: 1, den } : null;
  }
  // a split: one became several, or two became three (a spin-off's 1.05 is no such ratio)
  for (const den of [1, 2]) {
    const num = Math.round(factor * den);
    if (num > den && near(factor * den, num)) return { num, den };
  }
  return null;
}

/** A currency pair's latest quote (FactSet, delayed): the rate and when; null when there is none. */
export function readCurrencyQuote(text: string): { rate: number; at: string } | null {
  let q: { last?: unknown; datetimeLast?: unknown } | null | undefined;
  try {
    q = (JSON.parse(text) as { quote?: typeof q }).quote;
  } catch {
    return null;
  }
  const at = typeof q?.datetimeLast === 'string' ? Date.parse(q.datetimeLast) : NaN;
  if (!q || typeof q.last !== 'number' || !(q.last > 0) || Number.isNaN(at)) return null;
  return { rate: q.last, at: new Date(at).toISOString() };
}

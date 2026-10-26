/**
 * Gold prices to compare investments with. Pure: page or answer in, prices out.
 * - IBJA (India Bullion and Jewellers Association, ibjarates.com): the daily Indian reference
 *   rates, per 10 g, for 24K (999) and 22K (916), morning and evening — the rates RBI uses for
 *   gold bonds. Its page lists the last few trading days.
 * - The world spot price in US dollars per troy ounce (gold-api.com, current price only), and its
 *   history (freegoldapi.com: World Bank monthly averages, then daily closes).
 */
import { parseRate } from './currency.js';

/** "1,45,944", "&nbsp;145944 " → micros; null when it is not a number. */
const amount = (raw: string) => parseRate(raw.replace(/&nbsp;|\u00a0/g, '').replace(/[,\s]/g, ''));

/**
 * IBJA rates per gram (micros of ₹), one per day. A day takes one session for both purities:
 * the evening one when both its 24K and 22K rates are there, else the morning one. Today's
 * rates (shown apart from the table) are added only when the page's chart ends on `today` and
 * they differ from the table's last day (so yesterday's are never dated today).
 */
export function readIbja(
  page: string,
  today: string,
): { date: string; k24: number; k22: number }[] {
  const rows = [
    ...page.matchAll(
      /data-label="(AM|PM)"[^>]*>\s*(?:<strong>)?\s*(\d{2})\/(\d{2})\/(\d{4})\s*(?:<\/strong>)?\s*<\/td>([\s\S]*?)<\/tr>/g,
    ),
  ];
  if (rows.length === 0) throw new Error('IBJA did not send its rates table');
  const cell = (html: string, label: string) => {
    const m = html.match(new RegExp(`data-label="${label}"[^>]*>([^<]*)<`));
    return m ? amount(m[1]!) : null;
  };
  const byDay = new Map<string, { session: string; k24: number; k22: number }>();
  for (const [, session, d, m, y, html] of rows) {
    const k24 = cell(html!, 'Gold 999');
    const k22 = cell(html!, 'Gold 916');
    if (k24 === null || k22 === null) continue; // a session counts only with both purities
    const date = `${y}-${m}-${d}`;
    if (byDay.get(date)?.session === 'PM' && session === 'AM') continue;
    // per 10 grams → per gram
    byDay.set(date, { session: session!, k24: Math.round(k24 / 10), k22: Math.round(k22 / 10) });
  }
  if (byDay.size === 0) throw new Error('IBJA changed its rates table: no rate could be read');
  const out = [...byDay]
    .map(([date, r]) => ({ date, k24: r.k24, k22: r.k22 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Today's rates, shown apart without a date: dated by the chart only when it ends on today.
  const lastChartDay = [...page.matchAll(/(?:&quot;|")labels(?:&quot;|"):\[([^\]]*)\]/g)]
    .map((l) => l[1]!.match(/(\d{2})\/(\d{2})\/(\d{4})(?:&quot;|")?\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => `${m[3]}-${m[2]}-${m[1]}`)
    .sort()
    .at(-1);
  const label = (id: string) => {
    const m = page.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
    return m ? amount(m[1]!) : null;
  };
  const pm = [label('lblGold999_PM'), label('lblGold916_PM')];
  const am = [label('lblGold999_AM'), label('lblGold916_AM')];
  const [k24, k22] = pm.every((v) => v !== null) ? pm : am;
  const latest = out.at(-1)!;
  if (
    lastChartDay === today &&
    today > latest.date &&
    k24 != null &&
    k22 != null &&
    // the same as the table's last day: yesterday's rates still showing, not today's
    !(Math.round(k24 / 10) === latest.k24 && Math.round(k22 / 10) === latest.k22)
  ) {
    out.push({ date: today, k24: Math.round(k24 / 10), k22: Math.round(k22 / 10) });
  }
  return out;
}

/** The current world gold price: US dollars per troy ounce (micros), and its day (UTC). */
export function readGoldApi(text: string): { date: string; usd: number } {
  let body: { price?: unknown; updatedAt?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = {};
  }
  const price = typeof body.price === 'number' ? Math.round(body.price * 1_000_000) : null;
  const date = typeof body.updatedAt === 'string' ? body.updatedAt.slice(0, 10) : '';
  if (!price || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('The world gold price service gave an unexpected answer');
  }
  return { date, usd: price };
}

/**
 * The world gold price's history: US dollars per troy ounce (micros) by day, oldest first. Its
 * oldest rows are in other currencies (marked in their source): only dollar ones are kept.
 */
export function readGoldHistory(text: string): { date: string; usd: number }[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) throw new Error('The gold price history came in an unexpected form');
  return (rows as { date?: unknown; price?: unknown; source?: unknown }[])
    .filter(
      (r) =>
        typeof r.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
        typeof r.price === 'number' &&
        r.price > 0 &&
        // "measuringworth_british (GBP)": not dollars
        !/\((?!USD)[A-Z]{3}\)/.test(String(r.source ?? '')),
    )
    .map((r) => ({ date: r.date as string, usd: Math.round((r.price as number) * 1_000_000) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

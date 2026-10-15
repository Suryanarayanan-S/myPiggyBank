/**
 * NSE's daily "full bhavcopy" (sec_bhavdata_full_DDMMYYYY.csv): one row per instrument and series
 * with the day's closing price. Pure: text in, prices out.
 */
import { parseRate } from './currency.js';

export type Bhavcopy = {
  /** trading day, YYYY-MM-DD */
  date: string;
  /** "SYMBOL|SERIES" → closing price in micros per unit */
  close: Map<string, number>;
  /** series per symbol, in file order */
  series: Map<string, string[]>;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Regular markets, most preferred first (block deals "BL" and the like come last). */
const PREFERRED = ['EQ', 'BE', 'BZ', 'GB', 'IV', 'RR', 'RE'];

export const bhavcopyName = (day: string) =>
  `sec_bhavdata_full_${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}.csv`;

export function readBhavcopy(text: string): Bhavcopy {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = (lines[0] ?? '').split(',').map((h) => h.trim().toUpperCase());
  const at = (name: string) => head.indexOf(name);
  const [iSym, iSer, iDate, iClose] = ['SYMBOL', 'SERIES', 'DATE1', 'CLOSE_PRICE'].map(at);
  if ([iSym, iSer, iDate, iClose].some((i) => i! < 0) || lines.length < 2) {
    throw new Error('NSE did not send its end-of-day price file');
  }
  const close = new Map<string, number>();
  const series = new Map<string, string[]>();
  let date = '';
  for (const line of lines.slice(1)) {
    const c = line.split(',').map((x) => x.trim());
    if (c.length < head.length) continue; // a broken line: skip it, keep the rest
    const sym = c[iSym!]!.toUpperCase();
    const ser = c[iSer!]!.toUpperCase();
    if (!date) {
      const m = c[iDate!]!.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
      const month = m
        ? MONTHS.indexOf(m[2]!.slice(0, 1).toUpperCase() + m[2]!.slice(1).toLowerCase())
        : -1;
      if (m && month >= 0) date = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1]}`;
    }
    const price = parseRate(c[iClose!] ?? '');
    if (price === null) continue;
    close.set(`${sym}|${ser}`, price);
    series.set(sym, [...(series.get(sym) ?? []), ser]);
  }
  if (!date) throw new Error('NSE did not send its end-of-day price file');
  return { date, close, series };
}

/** The closing price of a holding's symbol, as Zerodha writes it ("SGBFEB32IV-GB" included). */
export function priceFor(b: Bhavcopy, symbol: string): number | null {
  const s = symbol.trim().toUpperCase();
  const pick = (sym: string, only?: string) => {
    const found = b.series.get(sym);
    if (!found) return null;
    const ser = only
      ? found.find((x) => x === only)
      : [...found].sort((x, y) => rank(x) - rank(y))[0];
    return ser ? (b.close.get(`${sym}|${ser}`) ?? null) : null;
  };
  const exact = pick(s);
  if (exact !== null) return exact;
  const dash = s.lastIndexOf('-');
  return dash > 0 ? pick(s.slice(0, dash), s.slice(dash + 1)) : null;
}
const rank = (series: string) => {
  const i = PREFERRED.indexOf(series);
  return i < 0 ? PREFERRED.length : i;
};

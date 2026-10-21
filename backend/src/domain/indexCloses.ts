/**
 * NSE's daily index closes (ind_close_all_DDMMYYYY.csv): one row per index with its closing
 * value. Pure: text in, values out.
 */
import { parseCsv } from './csv.js';
import { parseRate } from './currency.js';

export const indexClosesName = (day: string) =>
  `ind_close_all_${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}.csv`;

export function readIndexCloses(text: string) {
  const { rows } = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const iName = head.indexOf('index name');
  const iDate = head.indexOf('index date');
  const iClose = head.indexOf('closing index value');
  if (iName < 0 || iDate < 0 || iClose < 0 || rows.length < 2) {
    throw new Error('NSE did not send its index closes');
  }
  const m = (rows[1]![iDate] ?? '').trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) throw new Error('NSE did not send its index closes');
  const closes = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const value = parseRate((r[iClose] ?? '').trim());
    if (value !== null) closes.set((r[iName] ?? '').trim().toLowerCase(), value);
  }
  return {
    date: `${m[3]}-${m[2]}-${m[1]}`,
    /** closing value in micros, by index name (any case) */
    close: (name: string) => closes.get(name.trim().toLowerCase()) ?? null,
  };
}

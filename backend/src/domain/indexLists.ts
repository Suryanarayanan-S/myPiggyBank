/**
 * NSE's index constituent lists (ind_nifty500list.csv and friends): each company's industry,
 * and — from which index it is in — its SEBI size group (top 100 large, next 150 mid, rest
 * small). Pure: files in, classifications out.
 */
import { parseCsv } from './csv.js';

/** The lists, by the file name NSE publishes them under. */
export const INDEX_LISTS = {
  nifty500: 'ind_nifty500list.csv',
  nifty100: 'ind_nifty100list.csv',
  midcap150: 'ind_niftymidcap150list.csv',
  smallcap250: 'ind_niftysmallcap250list.csv',
  microcap250: 'ind_niftymicrocap250_list.csv',
} as const;
export type IndexList = keyof typeof INDEX_LISTS;
export type Listed = { symbol: string; industry: string };
export type Cap = 'large' | 'mid' | 'small';

export function readIndexList(text: string): Listed[] {
  const { rows } = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const iSym = head.indexOf('symbol');
  const iInd = head.indexOf('industry');
  if (iSym < 0 || iInd < 0) throw new Error('NSE did not send an index list');
  return rows
    .slice(1)
    .map((r) => ({
      symbol: (r[iSym] ?? '').trim().toUpperCase(),
      industry: (r[iInd] ?? '').trim(),
    }))
    .filter((r) => r.symbol && r.industry);
}

const CAP: Record<IndexList, Cap | null> = {
  nifty500: null, // only for the industry: its members are in the three below
  nifty100: 'large',
  midcap150: 'mid',
  smallcap250: 'small',
  microcap250: 'small', // ranks 501–750: small by SEBI's rule
};

export function classify(files: Record<IndexList, Listed[]>) {
  const out = new Map<string, { symbol: string; industry: string; cap: Cap | null }>();
  for (const list of Object.keys(INDEX_LISTS) as IndexList[]) {
    for (const l of files[list]) {
      const had = out.get(l.symbol);
      out.set(l.symbol, {
        symbol: l.symbol,
        industry: had?.industry ?? l.industry,
        cap: had?.cap ?? CAP[list],
      });
    }
  }
  return [...out.values()];
}

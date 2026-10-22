/**
 * NSE's daily list of corporate actions (bcDDMMYYYY.csv in PRddmmyy.zip): splits, bonus issues
 * and the like, with their ex-date — published from the day itself up to about a week ahead.
 * Pure: text in, actions out.
 */
import { parseCsv } from './csv.js';

export type CorporateAction = {
  symbol: string;
  /** YYYY-MM-DD: from this day the shares trade with the new units */
  exDate: string;
  purpose: string;
  /** split / bonus / consolidation change units by num/den; review: the user checks units and
   *  cost (demerger, rights issue, capital reduction, a split that cannot be read) */
  kind: 'split' | 'bonus' | 'consolidation' | 'review';
  num: number | null;
  den: number | null;
};

/** PR081026.zip for 8 Oct 2026. */
export const prName = (day: string) =>
  `PR${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(2, 4)}.zip`;

/** Events that change units or cost without a factor anyone can apply blindly. */
const REVIEW = /DEMERG|RIGHTS|CAPITAL REDUC|REDUCTION OF CAPITAL|AMALGAMAT|ARRANGEMENT/;
const SPLIT = /FV ?SPL?I?T|\bSPLIT\b|SUB-?DIVISION/;

/** "10" / "2.50" → hundredths (2.50 → 250), so factors stay whole numbers. */
const cents = (s: string) => Math.round(Number(s) * 100);
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const reduced = (num: number, den: number) => {
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
};

/** What a purpose means for the units held: null when it does not change them. */
function meaning(purpose: string): Pick<CorporateAction, 'kind' | 'num' | 'den'> | null {
  const p = purpose.toUpperCase();
  const fromTo = p.match(
    /(?:FRM|FROM)\s*(?:RS|RE|INR)?\.?\s*(\d+(?:\.\d+)?)[^0-9]*?TO\s*(?:RS|RE|INR)?\.?\s*(\d+(?:\.\d+)?)/,
  );
  const bonus = p.match(/BONUS\s*(\d+)\s*:\s*(\d+)/);
  const review = { kind: 'review' as const, num: null, den: null };
  if (REVIEW.test(p)) return review;
  const isSplit = SPLIT.test(p);
  const isConsolidation = /CONSOL/.test(p);
  if ((isSplit || isConsolidation) && bonus) return review; // two at once: too unusual to guess
  if (isSplit || isConsolidation) {
    if (!fromTo) return review;
    const [from, to] = [cents(fromTo[1]!), cents(fromTo[2]!)];
    if (!(from > 0 && to > 0) || from === to) return review;
    // Face value 10 → 2: each share becomes 5.
    return { kind: from > to ? 'split' : 'consolidation', ...reduced(from, to) };
  }
  if (bonus) {
    const [given, held] = [Number(bonus[1]), Number(bonus[2])];
    if (!(given > 0 && held > 0)) return review;
    // a new shares for every b held: b → a + b
    return { kind: 'bonus', ...reduced(given + held, held) };
  }
  return null;
}

export function readCorporateActions(text: string): CorporateAction[] {
  // Quoted fields (a company name with a comma) are read as one.
  const rows = parseCsv(text).rows;
  const head = (rows[0] ?? []).map((h) => h.trim().toUpperCase());
  const [iSym, iEx, iPurpose] = ['SYMBOL', 'EX_DT', 'PURPOSE'].map((n) => head.indexOf(n));
  if ([iSym, iEx, iPurpose].some((i) => i! < 0)) {
    throw new Error('NSE did not send its list of corporate actions');
  }
  const out: CorporateAction[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const c = row.map((x) => x.trim());
    // The purpose is the last column and may itself hold unquoted commas.
    const purpose = c.slice(iPurpose!).join(',').trim();
    const symbol = (c[iSym!] ?? '').toUpperCase();
    const exDate = c[iEx!] ?? '';
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(exDate)) continue;
    const m = meaning(purpose);
    if (!m) continue;
    // The same action is listed once per market (EQ, BE, BL…): kept once.
    const key = `${symbol}|${exDate}|${purpose}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol, exDate, purpose, ...m });
  }
  return out;
}

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
  kind: 'split' | 'bonus' | 'consolidation' | 'review' | 'dividend';
  num: number | null;
  den: number | null;
  /** dividends: micros of a rupee per share (or unit) */
  amount?: number | null;
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
    // ISO dates, or dd/mm/yyyy in the older lists
    const raw = c[iEx!] ?? '';
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const exDate = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : raw;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RUPEES = /R[se]\.?\s*-?\s*(\d+(?:\.\d+)?)/gi;

/**
 * What a dividend announcement pays per share (or InvIT/REIT unit), in micros; null when it is
 * not one. "Interim Dividend - Rs 10 Per Share Special Dividend - Rs 66 Per Share" pays 76; an
 * InvIT's "Distribution - Rs 3 Per Unit Consist Of …" pays 3, and one listed in parts (interest,
 * dividend, repayment of debt…) pays their sum — as brokers count it.
 */
export function dividendPerShare(subject: string): number | null {
  const s = subject.replace(/\s+/g, ' ').trim();
  const total = s.match(/Distribution\s*-\s*R[se]\.?\s*-?\s*(\d+(?:\.\d+)?)/i);
  if (total) return Math.round(Number(total[1]) * 1_000_000);
  if (!/dividend|distribution|interest/i.test(s) || /interest payment/i.test(s)) return null;
  // Announced with a bonus or split ("Bonus 1:1 And Dividend - Rs 5"): only the dividend's own
  // amounts (not the face value of the split).
  if (/split|bonus|buy ?back|demerger|amalgamation|rights|arrangement/i.test(s)) {
    const own = [...s.matchAll(/dividend\s*-?\s*R[se]\.?\s*-?\s*(\d+(?:\.\d+)?)/gi)].map((m) =>
      Number(m[1]),
    );
    return own.length ? Math.round(own.reduce((t, n) => t + n, 0) * 1_000_000) : null;
  }
  const parts = [...s.matchAll(RUPEES)].map((m) => Number(m[1]));
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((t, n) => t + n, 0) * 1_000_000);
}

/**
 * NSE's corporate-action history for a symbol (its website's JSON: symbol, exDate "22-Feb-2021",
 * subject): dividends with their amount, and splits, bonuses and the like (as in the daily list).
 */
export function readNseHistory(json: unknown): CorporateAction[] {
  if (!Array.isArray(json)) throw new Error('NSE did not send a list of corporate actions');
  const out: CorporateAction[] = [];
  const seen = new Set<string>();
  for (const r of json as { symbol?: string; exDate?: string; subject?: string }[]) {
    const m = (r.exDate ?? '').match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    const month = m
      ? MONTHS.indexOf(m[2]!.slice(0, 1).toUpperCase() + m[2]!.slice(1).toLowerCase())
      : -1;
    const symbol = (r.symbol ?? '').trim().toUpperCase();
    const purpose = (r.subject ?? '').replace(/\s+/g, ' ').trim();
    if (!m || month < 0 || !symbol || !purpose) continue;
    const exDate = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1]}`;
    const amount = dividendPerShare(purpose);
    const kind =
      amount !== null ? { kind: 'dividend' as const, num: null, den: null } : meaning(purpose);
    if (!kind) continue;
    const key = `${symbol}|${exDate}|${purpose}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol, exDate, purpose, ...kind, amount });
  }
  return out;
}

/** NSE's list of symbol changes (symbolchange.csv): which symbols a share was known by before. */
export function readSymbolChanges(text: string): { from: string; to: string }[] {
  const rows = parseCsv(text).rows;
  const head = (rows[0] ?? []).map((h) => h.trim().toUpperCase());
  const [iOld, iNew] = [head.indexOf('OLD SYMBOL'), head.indexOf('NEW SYMBOL')];
  if (iOld < 0 || iNew < 0) throw new Error('NSE did not send its list of symbol changes');
  return rows
    .slice(1)
    .map((r) => ({
      from: (r[iOld] ?? '').trim().toUpperCase(),
      to: (r[iNew] ?? '').trim().toUpperCase(),
    }))
    .filter((c) => c.from && c.to && c.from !== c.to);
}

/** Every former symbol of `symbol`, following renames back (TMPV → TATAMOTORS → TELCO). */
export function formerSymbols(changes: { from: string; to: string }[], symbol: string): string[] {
  const out: string[] = [];
  let current = [symbol];
  while (current.length) {
    const next = changes
      .filter((c) => current.includes(c.to) && !out.includes(c.from) && c.from !== symbol)
      .map((c) => c.from);
    out.push(...next);
    current = next;
  }
  return out;
}

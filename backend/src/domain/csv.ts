/** Bank-statement CSV reading: encoding, delimiter, quotes, German/English dates and amounts. */

/** UTF-8 (BOM stripped) if valid, otherwise Windows-1252 — what German bank exports use. */
export function decodeText(buf: Buffer): string {
  let bytes = buf;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const DELIMITERS = [';', ',', '\t'] as const;

function detectDelimiter(text: string): string {
  const firstLine: string[] = [];
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes) firstLine.push(ch);
  }
  return [...DELIMITERS].sort((a, b) => count(firstLine, b) - count(firstLine, a))[0]!;
}
const count = (chars: string[], c: string) => chars.filter((x) => x === c).length;

/** RFC 4180-style parser (quoted fields, doubled quotes, newlines in quotes, CRLF). */
export function parseCsv(
  text: string,
  /** when known (e.g. a broker's report); otherwise guessed from the text */
  known?: string,
): { delimiter: string; rows: string[][] } {
  const delimiter = known ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { delimiter, rows: rows.filter((r) => r.some((c) => c.trim() !== '')) };
}

export type ColumnMapping = {
  date: number | null;
  description: number | null;
  payee: number | null;
  amount: number | null;
  currency: number | null;
};

/** Best guess of the columns from the header row (German and English bank exports). */
export function guessMapping(headers: string[]): ColumnMapping {
  const h = headers.map((x) => x.trim().toLowerCase());
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = h.findIndex((x) => p.test(x));
      if (i > -1) return i;
    }
    return null;
  };
  return {
    date: find(/buchungstag/, /^(buchungs)?datum$/, /date|datum|booking/),
    description: find(/verwendungszweck/, /description|reference|memo|purpose|details/),
    payee: find(
      /beg(ue|ü)nstigter|zahlungspflichtiger|empf(ae|ä)nger|auftraggeber/,
      /payee|merchant|counterparty|^name$/,
    ),
    amount: find(/^betrag/, /amount|betrag|umsatz/),
    currency: find(/w(ae|ä)hrung/, /currency/),
  };
}

export type DateFormat = 'dd.mm.yyyy' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd';

/** Bank date → "YYYY-MM-DD", or null for impossible or unreadable dates. */
export function parseBankDate(input: string, format: DateFormat): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  if (format === 'yyyy-mm-dd') {
    const x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!x) return null;
    [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  } else {
    const sep = format === 'dd.mm.yyyy' ? '\\.' : '/';
    const x = s.match(new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2}|\\d{4})$`));
    if (!x) return null;
    const [a, b] = [Number(x[1]), Number(x[2])];
    [d, m] = format === 'mm/dd/yyyy' ? [b, a] : [a, b];
    y = x[3]!.length === 2 ? 2000 + Number(x[3]) : Number(x[3]);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

/** "-52,40" (decimal ",") or "1,234.56" (decimal ".") → signed cents; null if unreadable. */
export function parseBankAmount(input: string, decimal: ',' | '.'): number | null {
  let s = input.replace(/\s|€|\$|£|₹|EUR|INR|USD|GBP/gi, '');
  let sign = 1;
  if (s.startsWith('-') || s.endsWith('-')) sign = -1;
  s = s.replace(/^[+-]|-$/g, '');
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

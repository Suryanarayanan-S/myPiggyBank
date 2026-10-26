/**
 * Trade Republic's transactions export (Profile → Transactions → export as CSV): every cash and
 * trading movement with its ISIN, shares, amount, fee and tax. Buys, sells and dividends are
 * read; the rest (transfers, interest, card payments) is counted and left out. Pure.
 */
export type TradeRepublicRow = {
  line: number;
  /** Trade Republic's transaction_id: a row is imported once */
  ref: string;
  date: string;
  isin: string;
  name: string;
  kind: 'stock' | 'etf' | 'fund' | 'other';
  type: 'buy' | 'sell' | 'dividend';
  /** micro-units (0 for a dividend) */
  units: number;
  /** minor units, positive: paid (buy), received (sell), the dividend before tax */
  amount: number;
  /** minor units: the trade's fee; for a dividend, the tax withheld */
  fees: number;
  currency: string;
};
export type TradeRepublicError = { line: number; name: string; message: string };

const COLUMNS = ['date', 'category', 'type', 'symbol', 'shares', 'amount', 'currency'] as const;
const KIND: Record<string, TradeRepublicRow['kind']> = {
  STOCK: 'stock',
  ETF: 'etf',
  FUND: 'fund',
};
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const cents = (s: string) => Math.round(Number(s) * 100);
const realDay = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const isDay = (d: string) => {
  try {
    return realDay(d);
  } catch {
    return false; // not a date at all
  }
};

export function readTradeRepublic(rows: string[][]): {
  rows: TradeRepublicRow[];
  errors: TradeRepublicError[];
  /** rows that are not trades or dividends, by type */
  skipped: Record<string, number>;
} {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = (name: string) => head.indexOf(name);
  if (COLUMNS.some((c) => at(c) < 0) || at('transaction_id') < 0) {
    throw new Error(
      'This is not a transactions export from Trade Republic (date, category, type, symbol, shares, amount, …)',
    );
  }
  const get = (r: string[], name: string) => (r[at(name)] ?? '').trim();
  const out: TradeRepublicRow[] = [];
  const errors: TradeRepublicError[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.every((c) => !c.trim())) return;
    const category = get(r, 'category');
    const kind = get(r, 'type');
    const type =
      category === 'TRADING' && kind === 'BUY'
        ? 'buy'
        : category === 'TRADING' && kind === 'SELL'
          ? 'sell'
          : kind === 'DIVIDEND'
            ? 'dividend'
            : null;
    if (!type) {
      skipped[kind || category || '?'] = (skipped[kind || category || '?'] ?? 0) + 1;
      return;
    }
    const name = get(r, 'name') || get(r, 'symbol');
    const fail = (message: string) => errors.push({ line, name, message });
    const date = get(r, 'date');
    const isin = get(r, 'symbol');
    const shares = Number(get(r, 'shares'));
    const amount = Number(get(r, 'amount'));
    const ref = get(r, 'transaction_id');
    if (!isDay(date)) return fail('The date is not a date (YYYY-MM-DD)');
    if (!ISIN.test(isin)) return fail('There is no ISIN in the symbol column');
    if (!ref) return fail('The row has no transaction id');
    if (seen.has(ref)) return; // the same row twice in one file: once
    seen.add(ref);
    if (type !== 'dividend' && !(shares > 0)) return fail('The number of shares is not a number');
    if (!Number.isFinite(amount) || get(r, 'amount') === '')
      return fail('The amount is not a number');
    out.push({
      line,
      ref,
      date,
      isin,
      name,
      kind: KIND[get(r, 'asset_class')] ?? 'other',
      type,
      units: type === 'dividend' ? 0 : Math.round(shares * 1_000_000),
      // a dividend reversed (a negative row) takes the money back
      amount: type === 'dividend' ? cents(get(r, 'amount')) : Math.abs(cents(get(r, 'amount'))),
      fees: Math.abs(cents(get(r, type === 'dividend' ? 'tax' : 'fee') || '0')),
      currency: get(r, 'currency').toUpperCase(),
    });
  });
  return { rows: out, errors, skipped };
}

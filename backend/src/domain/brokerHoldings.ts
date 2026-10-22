/**
 * Holdings exported from a broker (Zerodha Kite "Holdings" CSV): one row per instrument with
 * quantity, average cost, last price and the money invested. Pure: rows in, holdings out.
 */
import { parseRate } from './currency.js';

export type BrokerHolding = {
  symbol: string;
  /** micro-units */
  units: number;
  /** minor units (paise) paid for what is held */
  invested: number;
  /** micros per unit */
  price: number;
};
export type BrokerRowError = { line: number; symbol: string; message: string };

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
const COLUMNS = {
  symbol: ['instrument', 'symbol', 'tradingsymbol'],
  units: ['qty', 'quantity', 'quantityavailable'],
  invested: ['invested', 'investedvalue'],
  price: ['ltp', 'lastprice', 'closingprice', 'previousclosingprice'],
} as const;

/**
 * "1234.5" or "1234,5" → 123450 minor units, rounded half up on the third decimal, in integer
 * arithmetic (no float surprises); null when it is not a plain non-negative number.
 */
function minor(s: string): number | null {
  const m = s.trim().match(/^(\d+)(?:[.,](\d+))?$/);
  if (!m) return null;
  const frac = (m[2] ?? '').padEnd(3, '0');
  const cents = Number(m[1]) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "NSE:INFY", "INFY.NS", "infy-eq" → "INFY", so the same instrument matches however it is written. */
export function plainSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/^(NSE|BSE):/, '')
    .replace(/\.(NS|BO|NSE|BSE)$/, '')
    .replace(/-(EQ|BE)$/, '');
}

export function readBrokerHoldings(rows: string[][]): {
  rows: BrokerHolding[];
  errors: BrokerRowError[];
} {
  const [head = [], ...data] = rows;
  const col = (names: readonly string[]) => head.findIndex((h) => names.includes(norm(h)));
  const at = {
    symbol: col(COLUMNS.symbol),
    units: col(COLUMNS.units),
    invested: col(COLUMNS.invested),
    price: col(COLUMNS.price),
  };
  if (Object.values(at).some((i) => i < 0)) {
    throw new Error(
      'This does not look like a holdings export. In Zerodha Kite open Portfolio → Holdings and download it as CSV.',
    );
  }
  const bySymbol = new Map<string, BrokerHolding>();
  const errors: BrokerRowError[] = [];
  data.forEach((r, i) => {
    const line = i + 2;
    const symbol = plainSymbol(r[at.symbol] ?? '');
    if (!symbol) return;
    const fail = (message: string) => errors.push({ line, symbol, message });
    const units = parseRate((r[at.units] ?? '').trim());
    if (units === null) return fail('Quantity is not a number above zero');
    const priceText = (r[at.price] ?? '').trim();
    if (!priceText) return fail('Last price is missing');
    const price = parseRate(priceText);
    if (price === null) return fail('Last price is not a number above zero');
    const invested = minor(r[at.invested] ?? '');
    if (invested === null) return fail('Invested amount is not a number');
    const same = bySymbol.get(symbol);
    if (same) {
      same.units += units;
      same.invested += invested;
      same.price = price;
    } else bySymbol.set(symbol, { symbol, units, invested, price });
  });
  return { rows: [...bySymbol.values()], errors };
}

// Listed InvITs and REITs whose symbols do not say so.
const TRUSTS = ['INDIGRID', 'EMBASSY', 'MINDSPACE', 'BIRET', 'NXST', 'IRBINVIT', 'PGINVIT'];

/** A best guess of the kind from the symbol; it can be changed on the holding afterwards. */
export function kindOf(symbol: string): 'stock' | 'etf' | 'gold' | 'other' {
  const s = plainSymbol(symbol);
  const fund = s.endsWith('BEES') || s.includes('ETF') || s.startsWith('SETF');
  // Sovereign gold bonds, and gold ETFs (GOLDBEES, SETFGOLD) — not stocks like GOLDIAM.
  if (s.startsWith('SGB') || (s.includes('GOLD') && (fund || s.endsWith('GOLD')))) return 'gold';
  if (s.includes('INVIT') || s.includes('REIT') || TRUSTS.some((t) => s.startsWith(t)))
    return 'other';
  if (fund) return 'etf';
  return 'stock';
}

/** A dividend or an interest payment from a broker's report (Zerodha Console). */
export type BrokerIncome = {
  line: number;
  symbol: string;
  /** ex-date, YYYY-MM-DD */
  date: string;
  /** paise */
  amount: number;
};

/**
 * Console's dividend report (Symbol, Ex-date, Qty, Dividend per share, Total dividend) or its
 * interest report (… Interest per share, Total interest — Sovereign Gold Bonds). Console marks
 * some symbols ("INFY#", "BAJAJ-AUTO*"); the marks are dropped.
 */
export function readBrokerIncome(rows: string[][]): {
  kind: 'dividend' | 'interest';
  rows: BrokerIncome[];
  errors: BrokerRowError[];
} {
  // The header may follow a title line or two.
  const start = Math.max(
    0,
    rows.slice(0, 10).findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'ex-date')),
  );
  const head = (rows[start] ?? []).map((h) => h.trim().toLowerCase());
  const at = (name: string) => head.indexOf(name);
  const kind =
    at('total dividend') >= 0 ? 'dividend' : at('total interest') >= 0 ? 'interest' : null;
  const [iSym, iDate] = [at('symbol'), at('ex-date')];
  if (!kind || iSym < 0 || iDate < 0) {
    throw new Error(
      'This is not a dividend or interest report from Zerodha Console (Symbol, Ex-date, … Total dividend / Total interest)',
    );
  }
  const iTotal = at(`total ${kind}`);
  const out: BrokerIncome[] = [];
  const errors: BrokerRowError[] = [];
  rows.slice(start + 1).forEach((r, i) => {
    const line = start + i + 2;
    const symbol = plainSymbol((r[iSym] ?? '').trim().replace(/[#*]+$/, ''));
    if (!symbol) return;
    const date = (r[iDate] ?? '').trim();
    const total = Number((r[iTotal] ?? '').trim().replace(/,/g, ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      errors.push({ line, symbol, message: 'The ex-date is not a date (YYYY-MM-DD)' });
    } else if (!(total > 0)) {
      errors.push({ line, symbol, message: `The total ${kind} is not an amount above zero` });
    } else {
      out.push({ line, symbol, date, amount: Math.round(total * 100) });
    }
  });
  return { kind, rows: out, errors };
}

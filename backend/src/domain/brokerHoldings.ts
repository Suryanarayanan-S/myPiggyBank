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

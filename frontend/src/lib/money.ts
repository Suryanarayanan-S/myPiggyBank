const LOCALES: Record<string, string> = {
  EUR: 'de-DE',
  INR: 'en-IN',
  USD: 'en-US',
  GBP: 'en-GB',
};

export function formatMoney(cents: number, currency = 'EUR', locale?: string): string {
  return new Intl.NumberFormat(locale ?? LOCALES[currency] ?? 'en-US', {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

const symbol = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? currency;

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** Short form for cards and charts: ₹80 L, ₹1.2 Cr, €128.5k, $2.5M. */
export function formatCompact(cents: number, currency = 'EUR'): string {
  const value = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  const sym = symbol(currency);
  if (currency === 'INR') {
    if (value >= 1e7) return `${sign}${sym}${String(Math.round((value / 1e7) * 100) / 100)} Cr`;
    if (value >= 1e5) return `${sign}${sym}${oneDecimal(value / 1e5)} L`;
    return `${sign}${sym}${Math.round(value).toLocaleString('en-IN')}`;
  }
  if (value >= 1e6) return `${sign}${sym}${oneDecimal(value / 1e6)}M`;
  if (value >= 1e3) return `${sign}${sym}${oneDecimal(value / 1e3)}k`;
  return `${sign}${sym}${Math.round(value)}`;
}

/** 1.234.567 / 1,234,567: first group 1–3 digits, then groups of 3. */
const isWesternGrouping = (g: string[]) =>
  g[0]!.length <= 3 && g.slice(1).every((x) => x.length === 3);

/** 1,23,45,678 (lakh/crore): commas only, first group 1–2 digits, then 2s, last group 3. */
const isIndianGrouping = (g: string[], intPart: string) =>
  !intPart.includes('.') &&
  g.length >= 3 &&
  g[0]!.length <= 2 &&
  g.slice(1, -1).every((x) => x.length === 2) &&
  g.at(-1)!.length === 3;

/**
 * Parses user-typed amounts like "52,40", "1.234,56", "1,234.56" or "5416 €" into cents.
 * The last "." or "," followed by 1–2 digits is the decimal separator; any other separators
 * must be a single kind of thousands separator in groups of three (or Indian lakh/crore grouping
 * with commas). Returns null if invalid.
 */
export function parseMoneyInput(input: string): number | null {
  const match = input.replace(/[\s€$£₹]/g, '').match(/^(-?)([\d.,]+)$/);
  if (!match) return null;
  const [, sign, body = ''] = match;

  const lastSep = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  let intPart = body;
  let frac = '';
  if (lastSep !== -1 && body.length - lastSep - 1 <= 2) {
    intPart = body.slice(0, lastSep);
    frac = body.slice(lastSep + 1);
    if (frac === '') return null;
  }

  const groups = intPart.split(/[.,]/);
  if (groups.some((g) => g === '')) return null;
  if (groups.length > 1 && !isWesternGrouping(groups) && !isIndianGrouping(groups, intPart)) {
    return null;
  }
  const thousandSeps = new Set(intPart.replace(/\d/g, ''));
  if (thousandSeps.size > 1) return null;
  if (frac && thousandSeps.has(body[lastSep]!)) return null;

  const cents = Number(groups.join('')) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return sign ? -cents : cents;
}

const UNITS: Record<string, number> = {
  l: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
};

/**
 * Like parseMoneyInput, but also understands lakh and crore: "80 L", "4.5 lac", "1.2 Cr",
 * "0,5 crore" (at most two decimals before the unit, so "1.234 L" is rejected as ambiguous).
 */
export function parseAmountInput(input: string): number | null {
  const m = input.trim().match(/^₹?\s*(\d+(?:[.,]\d{1,2})?)\s*([a-z]+)$/i);
  if (m) {
    const unit = UNITS[m[2]!.toLowerCase()];
    if (!unit) return null;
    const cents = Math.round(Number(m[1]!.replace(',', '.')) * unit * 100);
    return Number.isSafeInteger(cents) ? cents : null;
  }
  return parseMoneyInput(input);
}

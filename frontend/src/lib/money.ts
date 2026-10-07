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
    if (value >= 1e7) return `${sign}${sym}${oneDecimal(value / 1e7)} Cr`;
    if (value >= 1e5) return `${sign}${sym}${oneDecimal(value / 1e5)} L`;
    return `${sign}${sym}${Math.round(value).toLocaleString('en-IN')}`;
  }
  if (value >= 1e6) return `${sign}${sym}${oneDecimal(value / 1e6)}M`;
  if (value >= 1e3) return `${sign}${sym}${oneDecimal(value / 1e3)}k`;
  return `${sign}${sym}${Math.round(value)}`;
}

/**
 * Parses user-typed amounts like "52,40", "1.234,56", "1,234.56" or "5416 €" into cents.
 * The last "." or "," followed by 1–2 digits is the decimal separator; any other separators
 * must be a single kind of thousands separator in groups of three. Returns null if invalid.
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
  if (groups.length > 1 && (groups[0]!.length > 3 || groups.slice(1).some((g) => g.length !== 3))) {
    return null;
  }
  const thousandSeps = new Set(intPart.replace(/\d/g, ''));
  if (thousandSeps.size > 1) return null;
  if (frac && thousandSeps.has(body[lastSep]!)) return null;

  const cents = Number(groups.join('')) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return sign ? -cents : cents;
}

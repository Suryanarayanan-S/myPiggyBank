type Bucket = 'essentials' | 'fun' | 'future';
type Category = { id: string; name: string; kind: string; bucket: Bucket | null };
export type Suggestion = { categoryId: string } | { newName: string };

/** Keyword rules per bucket: first match wins, and only categories in the same bucket are used. */
const RULES: Record<Bucket | 'income', [RegExp, string][]> = {
  essentials: [
    [/rent|mortgage|miete/i, 'Rent'],
    [/grocer|supermarket|lebensmittel/i, 'Groceries'],
    [/transport|train|ticket|\bbus\b|fuel|petrol|deutschland/i, 'Transportation'],
    [/phone|mobile|handy/i, 'Phone'],
    [/electric|\bwater\b|heating|strom/i, 'Electricity'],
    [/wifi|internet|broadband/i, 'Internet'],
    [/insurance|versicherung/i, 'Insurance'],
    [/\btax\b|\bard\b|rundfunk/i, 'Tax'],
    [/\bbank\b/i, 'Bank fees'],
    [/\bgym\b|health|doctor|pharmacy|medic/i, 'Health'],
  ],
  fun: [
    [/prime|netflix|spotify|subscription|disney|youtube/i, 'Subscriptions'],
    [/restaurant|eating|hotel|food|oven|cafe|dining/i, 'Restaurants'],
    [/shop|shoes|amazon|cloth/i, 'Shopping'],
    [/movie|\btv\b|soundbar|entertain|cinema/i, 'Entertainment'],
    [/flight|trip|travel|vacation|holiday/i, 'Travel'],
    [/gift|donation/i, 'Gifts'],
  ],
  future: [
    [/\brd\b|recurring/i, 'Recurring deposit'],
    [/\betf\b|gold/i, 'ETF & Gold'],
    [/stock|share/i, 'Stocks'],
    [/\bgrt\b|scheme|emergency|\blic\b|\bfd\b/i, 'Savings scheme'],
    [/pension|rente/i, 'Pension'],
  ],
  income: [
    [/salary|gehalt/i, 'Salary'],
    [/bonus/i, 'Bonus'],
    [/\btax\b|refund/i, 'Tax refund'],
    [/interest|zins/i, 'Interest'],
    [/dividend/i, 'Dividends'],
    [/./, 'Other income'],
  ],
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Rule-based category for a free-text spreadsheet label. Designed so an AI-based provider could
 * replace it later behind the same signature.
 */
export function suggestCategory(
  label: string,
  kind: 'income' | 'expense',
  bucket: Bucket | null,
  categories: Category[],
): Suggestion {
  const pool = categories.filter(
    (c) => c.kind === kind && (kind === 'income' || c.bucket === bucket),
  );
  const exact = pool.find((c) => norm(c.name) === norm(label));
  if (exact) return { categoryId: exact.id };

  const byName = (name: string): Suggestion =>
    pool.find((c) => norm(c.name) === norm(name))
      ? { categoryId: pool.find((c) => norm(c.name) === norm(name))!.id }
      : { newName: name };

  const rules = kind === 'income' ? RULES.income : bucket ? RULES[bucket] : [];
  const rule = rules.find(([pattern]) => pattern.test(label));
  if (rule) return byName(rule[1]);
  // One-off labels ("Marriage expense") share the bucket's catch-all; the label stays on the
  // transaction as its merchant, so nothing is lost.
  return bucket ? byName(CATCH_ALL[bucket]) : { newName: tidy(label) };
}

export const CATCH_ALL: Record<Bucket, string> = {
  essentials: 'Other essentials',
  fun: 'Other fun',
  future: 'Other savings',
};

/** Built-in merchant keywords for bank statements (German and international). */
const BANK_KEYWORDS: { pattern: RegExp; kind: 'income' | 'expense'; category: string }[] = [
  {
    pattern: /\b(rewe|edeka|aldi|lidl|netto|penny|kaufland|dm-drogerie|rossmann)\b/i,
    kind: 'expense',
    category: 'Groceries',
  },
  {
    pattern: /netflix|spotify|disney|prime video|amazon prime|youtube premium/i,
    kind: 'expense',
    category: 'Subscriptions',
  },
  {
    pattern: /\b(db|bahn|mvv|bvg|hvv|vvs|uber|shell|aral|esso|jet)\b/i,
    kind: 'expense',
    category: 'Transportation',
  },
  { pattern: /\bmiete\b|\brent\b/i, kind: 'expense', category: 'Rent' },
  { pattern: /telekom|vodafone|\bo2\b|congstar/i, kind: 'expense', category: 'Phone' },
  {
    pattern: /stadtwerke|\bstrom\b|vattenfall|e\.on|eon\b/i,
    kind: 'expense',
    category: 'Electricity',
  },
  {
    pattern: /lieferando|restaurant|mcdonald|burger king|starbucks/i,
    kind: 'expense',
    category: 'Restaurants',
  },
  { pattern: /amazon|zalando|ikea|otto\b/i, kind: 'expense', category: 'Shopping' },
  { pattern: /versicherung|allianz|\bhuk\b|ergo\b|axa\b/i, kind: 'expense', category: 'Insurance' },
  { pattern: /gehalt|\blohn\b|salary/i, kind: 'income', category: 'Salary' },
  { pattern: /zinsen|interest/i, kind: 'income', category: 'Interest' },
];

/**
 * Category for a bank-statement line: learned rules first (longest matching pattern), then the
 * built-in merchant keywords. Only categories of the transaction's kind are suggested.
 * Same shape as an AI provider would have, so one can be plugged in later.
 */
export function suggestForBank(
  text: string,
  type: 'income' | 'expense',
  categories: Category[],
  rules: { pattern: string; categoryId: string }[],
): string | null {
  const lower = text.toLowerCase();
  const ofKind = (id: string) => categories.some((c) => c.id === id && c.kind === type);
  const learned = rules
    .filter((r) => r.pattern && lower.includes(r.pattern.toLowerCase()) && ofKind(r.categoryId))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  if (learned) return learned.categoryId;
  for (const k of BANK_KEYWORDS) {
    if (k.kind !== type || !k.pattern.test(text)) continue;
    const hit = categories.find((c) => c.kind === type && norm(c.name) === norm(k.category));
    if (hit) return hit.id;
  }
  return null;
}

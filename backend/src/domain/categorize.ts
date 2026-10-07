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

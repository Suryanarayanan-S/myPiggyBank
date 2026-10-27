import { z } from 'zod';
import { redact } from './redact.js';

type Bucket = 'essentials' | 'fun' | 'future';
type Kind = 'income' | 'expense';
export type AiCategory = { id: string; name: string; kind: string; bucket: string | null };
/** A bank-statement line: its text, whether money came in or went out, minor units. */
export type AiLine = { text: string; type: Kind; amount: number };

/** What the AI answers: per line number, the key of a category or null when unsure. */
export const CategorizeAnswer = z.object({
  answers: z.array(z.object({ line: z.number().int(), category: z.string().nullable() })),
});

export const CATEGORIZE_SYSTEM = [
  "You sort a family's bank-statement lines into the family's own categories.",
  'Each line has a type: "expense" (money went out) or "income" (money came in). Choose only a',
  "category of the same kind, by its key. Expense categories belong to the family's 50/30/20",
  'buckets: needs, wants and savings or investments.',
  'Use the payee and the purpose text, and the amount where it helps. When a line could fit',
  'several categories or you do not recognise the payee, answer null: the family picks it',
  'themselves, and a wrong guess costs them more than an empty box.',
  'Answer every line once.',
].join(' ');

const BUCKET_ROLE: Record<Bucket, string> = {
  essentials: 'needs',
  fun: 'wants',
  future: 'savings and investments',
};

/**
 * The request for a batch of lines. Categories travel as short keys (c1, c2…), never their ids;
 * each line's text is masked first (see `redact`).
 */
export function categorizePrompt(
  lines: AiLine[],
  categories: AiCategory[],
  bucketNames: Record<Bucket, string>,
  currency: string,
) {
  const keys = new Map(categories.map((c, i) => [`c${i + 1}`, c.id]));
  const payload = {
    currency,
    categories: categories.map((c, i) => ({
      key: `c${i + 1}`,
      name: c.name,
      kind: c.kind,
      ...(c.kind === 'expense' &&
        c.bucket && {
          bucket: `${bucketNames[c.bucket as Bucket]} (${BUCKET_ROLE[c.bucket as Bucket]})`,
        }),
    })),
    lines: lines.map((l, i) => ({
      line: i + 1,
      type: l.type,
      amount: (l.amount / 100).toFixed(2),
      text: redact(l.text),
    })),
  };
  return {
    prompt: `Suggest a category for each line.\n\n${JSON.stringify(payload)}`,
    keys,
  };
}

/**
 * The category id per line (same order as `lines`), or null. Unknown keys, a category of the
 * other kind and lines that were not asked about are dropped; the first answer for a line counts.
 */
export function readCategorizeAnswer(
  answer: z.output<typeof CategorizeAnswer>,
  lines: AiLine[],
  categories: AiCategory[],
  keys: Map<string, string>,
): (string | null)[] {
  const result: (string | null)[] = lines.map(() => null);
  const seen = new Set<number>();
  for (const a of answer.answers) {
    const i = a.line - 1;
    if (i < 0 || i >= lines.length || seen.has(i)) continue;
    seen.add(i);
    const id = a.category === null ? undefined : keys.get(a.category);
    const category = categories.find((c) => c.id === id);
    if (category && category.kind === lines[i]!.type) result[i] = category.id;
  }
  return result;
}

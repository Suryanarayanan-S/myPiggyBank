import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  CATEGORIZE_SYSTEM,
  CategorizeAnswer,
  categorizePrompt,
  readCategorizeAnswer,
  type AiLine,
} from '../domain/aiCategorize.js';
import { CurrencySchema } from '../domain/currency.js';
import { AppError } from '../lib/errors.js';
import { askAi, oneAtATime, type AiSetup } from './aiService.js';
import { listCategories } from './categoryService.js';
import { getFamily } from './familyService.js';

/** distinct texts asked about per request, and per call to the AI */
const MAX_LINES = 200;
const BATCH = 100;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export const CategorizeInput = z.object({
  currency: CurrencySchema,
  rows: z
    .array(
      z.object({
        index: z.number().int().min(0),
        description: z.string().trim().min(1).max(300),
        type: z.enum(['income', 'expense']),
        amount: z.number().int().positive().refine(Number.isSafeInteger),
      }),
    )
    .min(1)
    .max(5000),
});

/**
 * Categories for bank lines nothing else could place. The same text is asked about once; only
 * the family's own categories of the line's kind come back. A failure after the first batch
 * keeps what was found and says what went wrong.
 */
export async function suggestCategories(
  prisma: PrismaClient,
  familyId: string,
  ai: AiSetup | null,
  input: z.output<typeof CategorizeInput>,
) {
  return oneAtATime(familyId, () => suggest(prisma, familyId, ai, input));
}

async function suggest(
  prisma: PrismaClient,
  familyId: string,
  ai: AiSetup | null,
  input: z.output<typeof CategorizeInput>,
) {
  const groups = new Map<string, { line: AiLine; indexes: number[] }>();
  for (const r of input.rows) {
    const key = `${r.type}|${norm(r.description)}`;
    const group = groups.get(key);
    if (group) group.indexes.push(r.index);
    else
      groups.set(key, {
        line: { text: r.description, type: r.type, amount: r.amount },
        indexes: [r.index],
      });
  }
  const distinct = [...groups.values()];
  const asked = distinct.slice(0, MAX_LINES);
  const [categories, family] = await Promise.all([
    listCategories(prisma, familyId),
    getFamily(prisma, familyId),
  ]);

  const suggestions: { index: number; categoryId: string }[] = [];
  let error: string | null = null;
  for (let start = 0; start < asked.length; start += BATCH) {
    const batch = asked.slice(start, start + BATCH);
    const lines = batch.map((g) => g.line);
    const { prompt, keys } = categorizePrompt(
      lines,
      categories,
      family.bucketNames,
      input.currency,
    );
    let answer;
    try {
      answer = await askAi(prisma, familyId, ai, 'categorize', {
        system: CATEGORIZE_SYSTEM,
        prompt,
        schema: CategorizeAnswer,
      });
    } catch (err) {
      if (start === 0 || !(err instanceof AppError)) throw err;
      error = err.message;
      break;
    }
    if (!answer) continue;
    readCategorizeAnswer(answer, lines, categories, keys).forEach((categoryId, i) => {
      if (categoryId)
        for (const index of batch[i]!.indexes) suggestions.push({ index, categoryId });
    });
  }
  return { suggestions, asked: asked.length, left: distinct.length - asked.length, error };
}

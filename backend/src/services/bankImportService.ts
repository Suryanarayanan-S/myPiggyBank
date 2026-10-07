import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { suggestForBank } from '../domain/categorize.js';
import {
  decodeText,
  guessMapping,
  parseBankAmount,
  parseBankDate,
  parseCsv,
} from '../domain/csv.js';
import { formatDay, parseDay } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { listCategories } from './categoryService.js';
import { assertAccount } from './ownership.js';

const MAX_ROWS = 5000;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export const CsvPreviewInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(15_000_000),
});

export function previewCsv(input: z.output<typeof CsvPreviewInput>) {
  const text = decodeText(Buffer.from(input.data, 'base64'));
  const { delimiter, rows } = parseCsv(text);
  if (rows.length < 2) {
    throw new AppError(
      400,
      'INVALID_CSV',
      'This file has no rows to import. Export the statement as CSV from your bank.',
    );
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new AppError(
      400,
      'TOO_MANY_ROWS',
      `At most ${MAX_ROWS} rows per import — split the statement into smaller periods`,
    );
  }
  const [headers, ...data] = rows;
  return { delimiter, headers: headers!, rows: data, mapping: guessMapping(headers!) };
}

const col = z.number().int().min(0).max(200);
export const AnalyzeInput = z.object({
  accountId: z.uuid(),
  rows: z.array(z.array(z.string().max(2000)).max(200)).max(MAX_ROWS),
  mapping: z.object({
    date: col,
    description: col.nullable(),
    payee: col.nullable(),
    amount: col,
    dateFormat: z.enum(['dd.mm.yyyy', 'dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd']),
    decimal: z.enum([',', '.']),
    invert: z.boolean(),
  }),
});

const keyOf = (date: string, amount: number, type: string, text: string) =>
  `${date}|${amount}|${type}|${norm(text)}`;

export async function analyzeCsv(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof AnalyzeInput>,
) {
  await assertAccount(prisma, familyId, input.accountId);
  const m = input.mapping;
  const parsed = input.rows.map((cells, index) => {
    const description =
      [m.payee, m.description]
        .map((i) => (i === null ? '' : (cells[i] ?? '').trim()))
        .filter(Boolean)
        .join(' · ') || '(no description)';
    const date = parseBankDate(cells[m.date] ?? '', m.dateFormat);
    const signed = parseBankAmount(cells[m.amount] ?? '', m.decimal);
    const value = signed === null ? null : m.invert ? -signed : signed;
    const error =
      date === null
        ? 'Unreadable date'
        : value === null
          ? 'Unreadable amount'
          : value === 0
            ? 'Amount is zero'
            : null;
    return {
      index,
      date,
      amount: value === null ? null : Math.abs(value),
      type: (value ?? -1) > 0 ? ('income' as const) : ('expense' as const),
      description: description.slice(0, 300),
      error,
    };
  });

  // Duplicates: already in this account, or repeated inside the file.
  const valid = parsed.filter((r) => !r.error);
  const dates = valid.map((r) => r.date!).sort();
  const existing = new Set<string>();
  if (dates.length) {
    const rows = await prisma.transaction.findMany({
      where: {
        familyId,
        accountId: input.accountId,
        date: { gte: parseDay(dates[0]!)!, lte: parseDay(dates.at(-1)!)! },
        type: { in: ['income', 'expense'] },
      },
      select: { date: true, amount: true, type: true, merchant: true },
    });
    for (const t of rows)
      existing.add(keyOf(formatDay(t.date), Number(t.amount), t.type, t.merchant ?? ''));
  }
  const seen = new Set<string>();
  const [categories, rules] = await Promise.all([
    listCategories(prisma, familyId),
    prisma.categoryRule.findMany({
      where: { familyId },
      select: { pattern: true, categoryId: true },
    }),
  ]);
  const rows = parsed.map((r) => {
    if (r.error) return { ...r, duplicate: null, suggestion: null };
    const key = keyOf(r.date!, r.amount!, r.type, r.description);
    const duplicate = existing.has(key)
      ? ('existing' as const)
      : seen.has(key)
        ? ('file' as const)
        : null;
    seen.add(key);
    return {
      ...r,
      duplicate,
      suggestion: suggestForBank(r.description, r.type, categories, rules),
    };
  });
  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => !r.error).length,
      invalid: rows.filter((r) => r.error).length,
      duplicates: rows.filter((r) => !r.error && r.duplicate).length,
    },
  };
}

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
export const CommitCsvInput = z.object({
  accountId: z.uuid(),
  rows: z
    .array(
      z.object({
        date: day,
        amount: z.number().int().positive().refine(Number.isSafeInteger),
        type: z.enum(['income', 'expense']),
        description: z.string().trim().min(1).max(300),
        categoryId: z.uuid().nullable(),
      }),
    )
    .min(1)
    .max(MAX_ROWS),
  rememberRules: z
    .array(z.object({ pattern: z.string().trim().min(2).max(100), categoryId: z.uuid() }))
    .max(200)
    .optional(),
});

export async function commitCsv(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof CommitCsvInput>,
) {
  await assertAccount(prisma, familyId, input.accountId);
  const ids = [
    ...new Set([
      ...input.rows.map((r) => r.categoryId).filter((x): x is string => !!x),
      ...(input.rememberRules ?? []).map((r) => r.categoryId),
    ]),
  ];
  const categories = await prisma.category.findMany({ where: { familyId, id: { in: ids } } });
  if (categories.length !== ids.length) throw notFound('Category');
  const kind = new Map(categories.map((c) => [c.id, c.kind]));
  for (const r of input.rows) {
    if (r.categoryId && kind.get(r.categoryId) !== r.type) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `"${r.description}" needs an ${r.type} category`,
        [{ path: 'rows', message: `Choose an ${r.type} category` }],
      );
    }
  }
  const batch = `csv:${randomUUID()}`;
  const { count } = await prisma.$transaction(async (tx) => {
    for (const rule of input.rememberRules ?? []) {
      const pattern = norm(rule.pattern);
      await tx.categoryRule.upsert({
        where: { familyId_pattern: { familyId, pattern } },
        create: { familyId, pattern, categoryId: rule.categoryId },
        update: { categoryId: rule.categoryId },
      });
    }
    return tx.transaction.createMany({
      data: input.rows.map((r) => ({
        familyId,
        accountId: input.accountId,
        date: parseDay(r.date)!,
        amount: r.amount,
        type: r.type,
        categoryId: r.categoryId,
        merchant: r.description,
        notes: 'Imported from bank statement',
        importBatch: batch,
      })),
    });
  });
  return { created: count };
}

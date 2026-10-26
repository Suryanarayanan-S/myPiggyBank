import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { suggestCategory, type Suggestion } from '../domain/categorize.js';
import { parseSpendingWorkbook, type ImportBucket } from '../domain/spreadsheet.js';
import { MONTH_RE, monthRange } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import { AppError, notFound } from '../lib/errors.js';
import { listCategories } from './categoryService.js';
import { getFamily } from './familyService.js';
import { assertAccount } from './ownership.js';

const BUCKETS = ['essentials', 'fun', 'future'] as const;
const batchOf = (month: string) => `xlsx:${month}`;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
export const labelKey = (kind: 'income' | 'expense', bucket: ImportBucket | null, label: string) =>
  `${kind}|${bucket ?? ''}|${norm(label)}`;

export const PreviewInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(15_000_000),
});

const cents = z.number().int().positive().refine(Number.isSafeInteger);
const row = { label: z.string().trim().min(1).max(100), amount: cents };
const target = z.union([
  z.object({ categoryId: z.uuid() }),
  z.object({ newName: z.string().trim().min(1).max(50) }),
]);
export const CommitInput = z.object({
  account: z.union([
    z.object({ id: z.uuid() }),
    z.object({ newName: z.string().trim().min(1).max(60) }),
  ]),
  months: z
    .array(
      z.object({
        month: z.string().regex(MONTH_RE),
        sheet: z.string().max(60),
        mode: z.enum(['import', 'replace']),
        income: z.array(z.object(row)).max(100),
        items: z.array(z.object({ ...row, bucket: z.enum(BUCKETS) })).max(1000),
      }),
    )
    .min(1)
    .max(240)
    .refine((ms) => new Set(ms.map((m) => m.month)).size === ms.length, 'Each month only once'),
  mapping: z.record(z.string().max(300), target),
});

async function existingCounts(prisma: Db, familyId: string, month: string) {
  const { start, end } = monthRange(month);
  const [imported, manual] = await Promise.all([
    prisma.transaction.count({ where: { familyId, importBatch: batchOf(month) } }),
    prisma.transaction.count({
      where: { familyId, importBatch: null, date: { gte: start, lt: end } },
    }),
  ]);
  return { imported, manual };
}

export async function previewImport(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof PreviewInput>,
) {
  const { months, skippedSheets } = await parseSpendingWorkbook(Buffer.from(input.data, 'base64'));
  const categories = await listCategories(prisma, familyId);

  const labels = new Map<
    string,
    {
      key: string;
      kind: 'income' | 'expense';
      bucket: ImportBucket | null;
      label: string;
      occurrences: number;
      total: number;
      suggestion: Suggestion;
    }
  >();
  const add = (
    kind: 'income' | 'expense',
    bucket: ImportBucket | null,
    label: string,
    amount: number,
  ) => {
    const key = labelKey(kind, bucket, label);
    const entry = labels.get(key) ?? {
      key,
      kind,
      bucket,
      label,
      occurrences: 0,
      total: 0,
      suggestion: suggestCategory(label, kind, bucket, categories),
    };
    entry.occurrences += 1;
    entry.total += amount;
    labels.set(key, entry);
  };
  for (const m of months) {
    for (const i of m.income) add('income', null, i.label, i.amount);
    for (const i of m.items) add('expense', i.bucket, i.label, i.amount);
  }

  return {
    months: await Promise.all(
      months.map(async (m) => ({
        ...m,
        existing: await existingCounts(prisma, familyId, m.month),
      })),
    ),
    labels: [...labels.values()],
    skippedSheets,
  };
}

export async function commitImport(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof CommitInput>,
) {
  // Everything — checks and writes — happens in one transaction that first takes SQLite's write
  // lock, so concurrent commits (two tabs, a retry) run one after another instead of racing.
  return prisma.$transaction(
    async (tx) => {
      await tx.family.update({ where: { id: familyId }, data: { updatedAt: new Date() } });
      const family = await getFamily(tx, familyId);
      const currency = family.spendingCurrency;

      // 1. Account: existing (in the spending currency) or a new/reused history account.
      let accountId: string | null = null;
      let newAccountName: string | null = null;
      if ('id' in input.account) {
        const acc = await assertAccount(tx, familyId, input.account.id);
        if (acc.currency !== currency) {
          throw new AppError(
            400,
            'ACCOUNT_CURRENCY',
            `Choose an account in ${currency}: the spreadsheet amounts are in ${currency}`,
          );
        }
        accountId = acc.id;
      } else {
        const name = input.account.newName;
        // the account it would create is shared: only a shared one of that name is the same
        const same = (await tx.account.findMany({ where: { familyId, ownerMemberId: null } })).find(
          (a) => norm(a.name) === norm(name),
        );
        if (same && same.currency !== currency) {
          throw new AppError(
            409,
            'ACCOUNT_EXISTS',
            `An account named "${same.name}" exists in ${same.currency}`,
          );
        }
        if (same) accountId = same.id;
        else newAccountName = name;
      }

      // 2. Every row needs a mapping consistent with its kind and bucket.
      const rows = input.months.flatMap((m) => [
        ...m.income.map((r) => ({ m, kind: 'income' as const, bucket: null, ...r })),
        ...m.items.map((r) => ({ m, kind: 'expense' as const, ...r })),
      ]);
      const categories = await tx.category.findMany({ where: { familyId } });
      const pendingBucket = new Map<string, string | null>(); // kind|name → bucket of a new category
      const resolved = new Map<
        string,
        { categoryId: string } | { newName: string; kind: string; bucket: string | null }
      >();
      for (const r of rows) {
        const key = labelKey(r.kind, r.bucket, r.label);
        if (resolved.has(key)) continue;
        const t = input.mapping[key];
        if (!t) {
          throw new AppError(400, 'MAPPING_MISSING', `Choose a category for "${r.label}"`, [
            { path: 'mapping', message: key },
          ]);
        }
        if ('categoryId' in t) {
          const cat = categories.find((c) => c.id === t.categoryId);
          if (!cat) throw notFound('Category');
          if (cat.kind !== r.kind || (r.kind === 'expense' && cat.bucket !== r.bucket)) {
            throw new AppError(
              400,
              'MAPPING_MISMATCH',
              `"${cat.name}" does not fit "${r.label}" (different bucket)`,
            );
          }
          resolved.set(key, { categoryId: cat.id });
          continue;
        }
        const nameKey = `${r.kind}|${norm(t.newName)}`;
        const same = categories.find((c) => c.kind === r.kind && norm(c.name) === norm(t.newName));
        const otherBucket = same
          ? same.bucket !== r.bucket
          : pendingBucket.has(nameKey) && pendingBucket.get(nameKey) !== r.bucket;
        if (otherBucket) {
          throw new AppError(
            409,
            'CATEGORY_EXISTS',
            `"${t.newName}" can only belong to one bucket. Pick a different name for one of them.`,
          );
        }
        if (same) resolved.set(key, { categoryId: same.id });
        else {
          pendingBucket.set(nameKey, r.bucket);
          resolved.set(key, { newName: t.newName, kind: r.kind, bucket: r.bucket });
        }
      }

      // 3. Months already imported need an explicit replace.
      for (const m of input.months) {
        if (m.mode === 'import' && (await existingCounts(tx, familyId, m.month)).imported > 0) {
          throw new AppError(
            409,
            'MONTH_ALREADY_IMPORTED',
            `${m.sheet} was already imported. Choose "Replace" or skip it.`,
          );
        }
      }

      // 4. Writes.
      if (newAccountName) {
        // Archived: its balance (three years of unused money) is not a real bank balance, so it
        // stays out of account totals; the budget still counts its transactions.
        accountId = (
          await tx.account.create({
            data: {
              familyId,
              name: newAccountName,
              type: 'other',
              currency,
              assetClass: 'other',
              archived: true,
            },
          })
        ).id;
      }
      const newCategories: string[] = [];
      const idFor = new Map<string, string>();
      for (const [key, t] of resolved) {
        if ('categoryId' in t) {
          idFor.set(key, t.categoryId);
          continue;
        }
        const nameKey = `${t.kind}|${norm(t.newName)}`;
        if (!idFor.has(nameKey)) {
          const created = await tx.category.create({
            data: { familyId, name: t.newName, kind: t.kind, bucket: t.bucket },
          });
          newCategories.push(created.name);
          idFor.set(nameKey, created.id);
        }
        idFor.set(key, idFor.get(nameKey)!);
      }
      await tx.transaction.deleteMany({
        where: {
          familyId,
          importBatch: {
            in: input.months.filter((m) => m.mode === 'replace').map((m) => batchOf(m.month)),
          },
        },
      });
      const { count } = await tx.transaction.createMany({
        data: rows.map((r) => ({
          familyId,
          accountId: accountId!,
          date: monthRange(r.m.month).start,
          amount: r.amount,
          currency,
          type: r.kind,
          categoryId: idFor.get(labelKey(r.kind, r.bucket, r.label))!,
          merchant: r.label,
          notes: `Imported from "${r.m.sheet}"`,
          importBatch: batchOf(r.m.month),
        })),
      });
      return {
        created: count,
        months: input.months.map((m) => m.month).sort(),
        newCategories,
        accountId: accountId!,
      };
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
}

import type { Category, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { assertCategory } from './ownership.js';

export const BUCKETS = ['essentials', 'fun', 'future'] as const;
export type Bucket = (typeof BUCKETS)[number];

const DEFAULTS: { kind: 'income' | 'expense'; bucket: Bucket | null; names: string[] }[] = [
  {
    kind: 'income',
    bucket: null,
    names: ['Salary', 'Bonus', 'Other income', 'Tax refund', 'Interest', 'Dividends'],
  },
  {
    kind: 'expense',
    bucket: 'essentials',
    names: [
      'Rent',
      'Groceries',
      'Transportation',
      'Phone',
      'Electricity',
      'Internet',
      'Insurance',
      'Tax',
      'Bank fees',
      'Health',
    ],
  },
  {
    kind: 'expense',
    bucket: 'fun',
    names: ['Restaurants', 'Shopping', 'Subscriptions', 'Entertainment', 'Travel', 'Gifts'],
  },
  {
    kind: 'expense',
    bucket: 'future',
    names: ['Recurring deposit', 'Stocks', 'ETF & Gold', 'Savings scheme', 'Pension'],
  },
];

export async function seedDefaultCategories(
  db: PrismaClient | Prisma.TransactionClient,
  familyId: string,
) {
  await db.category.createMany({
    data: DEFAULTS.flatMap((g) =>
      g.names.map((name, sortOrder) => ({
        familyId,
        name,
        kind: g.kind,
        bucket: g.bucket,
        sortOrder,
      })),
    ),
  });
}

const name = z.string().trim().min(1, 'Name is required').max(50);
const bucket = z.enum(BUCKETS);

export const CategoryCreate = z
  .object({ name, kind: z.enum(['income', 'expense']), bucket: bucket.optional() })
  .refine((c) => (c.kind === 'expense') === (c.bucket !== undefined), {
    message: 'Expense categories need a bucket; income categories have none',
    path: ['bucket'],
  });
export const CategoryUpdate = z.object({
  name: name.optional(),
  bucket: bucket.optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export type CategoryDto = {
  id: string;
  name: string;
  kind: string;
  bucket: Bucket | null;
  sortOrder: number;
};
const toDto = (c: Category): CategoryDto => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  bucket: c.bucket as Bucket | null,
  sortOrder: c.sortOrder,
});

async function assertNameFree(
  prisma: PrismaClient,
  familyId: string,
  kind: string,
  newName: string,
  exceptId?: string,
) {
  const all = await prisma.category.findMany({
    where: { familyId, kind },
    select: { id: true, name: true },
  });
  if (all.some((c) => c.id !== exceptId && c.name.toLowerCase() === newName.toLowerCase())) {
    throw new AppError(409, 'CATEGORY_EXISTS', 'A category with this name already exists');
  }
}

const BUCKET_ORDER: Record<string, number> = { essentials: 1, fun: 2, future: 3 };

export async function listCategories(prisma: PrismaClient, familyId: string) {
  let cats = await prisma.category.findMany({ where: { familyId } });
  if (cats.length === 0) {
    await seedDefaultCategories(prisma, familyId);
    cats = await prisma.category.findMany({ where: { familyId } });
  }
  return cats
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) * -1 || // income first
        (BUCKET_ORDER[a.bucket ?? ''] ?? 0) - (BUCKET_ORDER[b.bucket ?? ''] ?? 0) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    )
    .map(toDto);
}

export async function createCategory(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof CategoryCreate>,
) {
  await assertNameFree(prisma, familyId, input.kind, input.name);
  const count = await prisma.category.count({
    where: { familyId, kind: input.kind, bucket: input.bucket ?? null },
  });
  return toDto(
    await prisma.category.create({
      data: {
        familyId,
        name: input.name,
        kind: input.kind,
        bucket: input.bucket ?? null,
        sortOrder: count,
      },
    }),
  );
}

export async function updateCategory(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof CategoryUpdate>,
) {
  const existing = await assertCategory(prisma, familyId, id);
  if (input.bucket && existing.kind === 'income') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Income categories have no bucket', [
      { path: 'bucket', message: 'Income categories have no bucket' },
    ]);
  }
  if (input.name) await assertNameFree(prisma, familyId, existing.kind, input.name, id);
  return toDto(await prisma.category.update({ where: { id }, data: input }));
}

export async function deleteCategory(prisma: PrismaClient, familyId: string, id: string) {
  await assertCategory(prisma, familyId, id);
  if (await prisma.transaction.count({ where: { categoryId: id } })) {
    throw new AppError(
      409,
      'CATEGORY_IN_USE',
      'This category is used by transactions. Move them to another category first.',
    );
  }
  await prisma.category.delete({ where: { id } });
}

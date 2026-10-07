import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { formatDay, parseDay } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertAccount, assertCategory, assertMember } from './ownership.js';

const TYPES = ['income', 'expense', 'transfer'] as const;
const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const cents = z.number().int('Amount must be in whole cents').positive('Amount must be above zero');

export const TransactionInput = z
  .object({
    date: day,
    amount: cents.refine(Number.isSafeInteger, 'Amount is too large'),
    type: z.enum(TYPES),
    accountId: z.uuid(),
    categoryId: z.uuid().nullable().optional(),
    memberId: z.uuid().nullable().optional(),
    merchant: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    tags: z.array(z.string().trim().max(30)).max(10).optional(),
    transferAccountId: z.uuid().nullable().optional(),
    transferAmount: cents.nullable().optional(),
  })
  .superRefine((t, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (t.type === 'transfer') {
      if (!t.transferAccountId)
        issue('transferAccountId', 'Choose the account receiving the money');
      else if (t.transferAccountId === t.accountId)
        issue('transferAccountId', 'Choose a different account to transfer to');
      if (t.categoryId) issue('categoryId', 'Transfers have no category');
    } else if (t.transferAccountId || t.transferAmount) {
      issue('transferAccountId', 'Only transfers have a receiving account');
    }
  });
type Input = z.output<typeof TransactionInput>;

export const ListQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  type: z.enum(TYPES).optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  memberId: z.union([z.uuid(), z.literal('shared')]).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['date', 'amount']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const include = {
  account: { select: { name: true, currency: true } },
  category: { select: { name: true, bucket: true } },
  member: { select: { name: true } },
  transferAccount: { select: { name: true, currency: true } },
} as const;
type Row = Prisma.TransactionGetPayload<{ include: typeof include }>;

export type TransactionDto = ReturnType<typeof toDto>;
function toDto(t: Row) {
  return {
    id: t.id,
    date: formatDay(t.date),
    amount: t.amount,
    currency: t.account.currency,
    type: t.type,
    accountId: t.accountId,
    accountName: t.account.name,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    bucket: t.category?.bucket ?? null,
    memberId: t.memberId,
    memberName: t.member?.name ?? null,
    merchant: t.merchant,
    notes: t.notes,
    tags: t.tags.split(',').filter(Boolean),
    transferAccountId: t.transferAccountId,
    transferAccountName: t.transferAccount?.name ?? null,
    transferAmount: t.transferAmount,
    transferCurrency: t.transferAccount?.currency ?? null,
  };
}

const normalizeTags = (tags: string[] = []) => {
  const clean = [
    ...new Set(tags.map((t) => t.trim().toLowerCase().replace(/,/g, '')).filter(Boolean)),
  ];
  return clean.length ? `,${clean.join(',')},` : '';
};

/** Validates references against the family and builds the row data. */
async function toData(prisma: PrismaClient, familyId: string, input: Input) {
  const account = await assertAccount(prisma, familyId, input.accountId);
  if (input.categoryId) {
    const category = await assertCategory(prisma, familyId, input.categoryId);
    if (category.kind !== input.type) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'categoryId', message: `Choose an ${input.type} category` },
      ]);
    }
  }
  if (input.memberId) await assertMember(prisma, familyId, input.memberId);

  let transferAmount: number | null = null;
  if (input.type === 'transfer' && input.transferAccountId) {
    const dest = await assertAccount(prisma, familyId, input.transferAccountId);
    if (dest.currency === account.currency) transferAmount = input.amount;
    else if (input.transferAmount) transferAmount = input.transferAmount;
    else {
      throw new AppError(
        400,
        'TRANSFER_AMOUNT_REQUIRED',
        `Enter the amount received in ${dest.currency}`,
      );
    }
  }

  return {
    familyId,
    accountId: account.id,
    date: parseDay(input.date)!,
    amount: input.amount,
    type: input.type,
    categoryId: input.type === 'transfer' ? null : (input.categoryId ?? null),
    memberId: input.memberId ?? null,
    merchant: input.merchant || null,
    notes: input.notes || null,
    tags: normalizeTags(input.tags),
    transferAccountId: input.type === 'transfer' ? input.transferAccountId! : null,
    transferAmount,
  };
}

export async function createTransaction(prisma: PrismaClient, familyId: string, input: Input) {
  const data = await toData(prisma, familyId, input);
  return toDto(await prisma.transaction.create({ data, include }));
}

async function assertTransaction(prisma: PrismaClient, familyId: string, id: string) {
  if (!(await prisma.transaction.findFirst({ where: { id, familyId }, select: { id: true } }))) {
    throw notFound('Transaction');
  }
}

export async function updateTransaction(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: Input,
) {
  await assertTransaction(prisma, familyId, id);
  const data = await toData(prisma, familyId, input);
  return toDto(await prisma.transaction.update({ where: { id }, data, include }));
}

export async function deleteTransaction(prisma: PrismaClient, familyId: string, id: string) {
  await assertTransaction(prisma, familyId, id);
  await prisma.transaction.delete({ where: { id } });
}

export async function listTransactions(
  prisma: PrismaClient,
  familyId: string,
  q: z.output<typeof ListQuery>,
) {
  const and: Prisma.TransactionWhereInput[] = [{ familyId }];
  if (q.from) and.push({ date: { gte: parseDay(q.from)! } });
  if (q.to) and.push({ date: { lt: new Date(parseDay(q.to)!.getTime() + 86_400_000) } });
  if (q.type) and.push({ type: q.type });
  if (q.accountId)
    and.push({ OR: [{ accountId: q.accountId }, { transferAccountId: q.accountId }] });
  if (q.categoryId) and.push({ categoryId: q.categoryId });
  if (q.memberId) and.push({ memberId: q.memberId === 'shared' ? null : q.memberId });
  if (q.q) {
    and.push({
      OR: [
        { merchant: { contains: q.q } },
        { notes: { contains: q.q } },
        { tags: { contains: q.q.toLowerCase() } },
        { category: { name: { contains: q.q } } },
      ],
    });
  }
  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include,
      orderBy: [{ [q.sort]: q.order }, { date: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
}

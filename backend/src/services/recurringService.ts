import { Prisma, type PrismaClient, type RecurringRule } from '@prisma/client';
import { z } from 'zod';
import { nextOccurrence, occurrences, type Frequency } from '../domain/recurring.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertAccount, assertCategory, assertMember } from './ownership.js';

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const amount = z
  .number()
  .int('Amount must be in whole cents')
  .positive()
  .refine(Number.isSafeInteger);
const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
const today = () => todayLocal();

export const RecurringCreate = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['income', 'expense']),
  amount,
  accountId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  memberId: z.uuid().nullable().optional(),
  frequency: z.enum(FREQUENCIES),
  startDate: day,
  endDate: day.nullable().optional(),
  /** Also create the occurrences between the start date and today. */
  backfill: z.boolean().optional(),
});
export const RecurringUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  amount: amount.optional(),
  categoryId: z.uuid().nullable().optional(),
  memberId: z.uuid().nullable().optional(),
  endDate: day.nullable().optional(),
  active: z.boolean().optional(),
});

const include = {
  account: { select: { name: true, currency: true } },
  category: { select: { name: true } },
} as const;
type Row = Prisma.RecurringRuleGetPayload<{ include: typeof include }>;
const asRule = (r: RecurringRule) => ({
  frequency: r.frequency as Frequency,
  startDate: formatDay(r.startDate),
  endDate: r.endDate ? formatDay(r.endDate) : null,
});
const toDto = (r: Row) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  amount: Number(r.amount),
  currency: r.account.currency,
  accountId: r.accountId,
  accountName: r.account.name,
  categoryId: r.categoryId,
  categoryName: r.category?.name ?? null,
  memberId: r.memberId,
  frequency: r.frequency,
  startDate: formatDay(r.startDate),
  endDate: r.endDate ? formatDay(r.endDate) : null,
  active: r.active,
  // Everything up to today is generated already, so "next" is after today — or, for a rule that
  // starts generating later, its first date itself.
  nextDate: r.active
    ? nextOccurrence(asRule(r), maxDay(today(), dayBefore(formatDay(r.generateFrom))))
    : null,
});
const maxDay = (a: string, b: string) => (a > b ? a : b);
const dayBefore = (d: string) => formatDay(new Date(parseDay(d)!.getTime() - 86_400_000));

async function checkRefs(
  prisma: PrismaClient,
  familyId: string,
  type: string,
  refs: { accountId?: string; categoryId?: string | null; memberId?: string | null },
) {
  if (refs.accountId) {
    const a = await assertAccount(prisma, familyId, refs.accountId);
    if (a.archived) throw new AppError(400, 'ACCOUNT_ARCHIVED', 'Choose an active account');
  }
  if (refs.categoryId) {
    const c = await assertCategory(prisma, familyId, refs.categoryId);
    if (c.kind !== type) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'categoryId', message: `Choose an ${type} category` },
      ]);
    }
  }
  if (refs.memberId) await assertMember(prisma, familyId, refs.memberId);
}

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const r = await prisma.recurringRule.findFirst({ where: { id, familyId } });
  if (!r) throw notFound('Recurring transaction');
  return r;
}

export async function listRecurring(prisma: PrismaClient, familyId: string) {
  const rows = await prisma.recurringRule.findMany({
    where: { familyId },
    include,
    orderBy: { name: 'asc' },
  });
  return rows.map(toDto);
}

export async function createRecurring(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof RecurringCreate>,
) {
  await checkRefs(prisma, familyId, input.type, input);
  const { backfill, startDate, endDate, ...rest } = input;
  const r = await prisma.recurringRule.create({
    data: {
      ...rest,
      familyId,
      startDate: parseDay(startDate)!,
      endDate: endDate ? parseDay(endDate) : null,
      generateFrom: parseDay(backfill ? startDate : maxDay(today(), startDate))!,
    },
  });
  await generateDue(prisma, today(), familyId);
  return toDto(await prisma.recurringRule.findUniqueOrThrow({ where: { id: r.id }, include }));
}

export async function updateRecurring(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof RecurringUpdate>,
) {
  const existing = await owned(prisma, familyId, id);
  await checkRefs(prisma, familyId, existing.type, input);
  const { endDate, ...rest } = input;
  // Resuming skips the paused period: nothing before today is generated afterwards.
  const resuming = input.active === true && !existing.active;
  await prisma.recurringRule.update({
    where: { id },
    data: {
      ...rest,
      ...(endDate !== undefined && { endDate: endDate ? parseDay(endDate) : null }),
      ...(resuming && {
        generateFrom: parseDay(maxDay(today(), formatDay(existing.generateFrom)))!,
      }),
    },
  });
  return toDto(await prisma.recurringRule.findUniqueOrThrow({ where: { id }, include }));
}

/** Past transactions stay (their link is cleared); only future generation stops. */
export async function deleteRecurring(prisma: PrismaClient, familyId: string, id: string) {
  await owned(prisma, familyId, id);
  await prisma.recurringRule.delete({ where: { id } });
}

/** Creates every due occurrence up to `asOf` (never in the future). Safe to run repeatedly. */
export async function generateDue(prisma: PrismaClient, asOf: string, familyId?: string) {
  const rules = await prisma.recurringRule.findMany({
    where: { active: true, ...(familyId && { familyId }) },
    include: { account: { select: { archived: true } } },
  });
  let created = 0;
  for (const r of rules) {
    if (r.account.archived) continue;
    // Start after the watermark: dates already generated are never re-created, even if the user
    // deleted or moved that transaction.
    const from = r.generatedThrough
      ? maxDay(
          formatDay(r.generateFrom),
          formatDay(new Date(r.generatedThrough.getTime() + 86_400_000)),
        )
      : formatDay(r.generateFrom);
    const due = occurrences(asRule(r), from, asOf);
    if (!r.generatedThrough || formatDay(r.generatedThrough) < asOf) {
      await prisma.recurringRule.update({
        where: { id: r.id },
        data: { generatedThrough: parseDay(asOf)! },
      });
    }
    if (!due.length) continue;
    const have = new Set(
      (
        await prisma.transaction.findMany({
          where: { recurringRuleId: r.id },
          select: { date: true },
        })
      ).map((t) => formatDay(t.date)),
    );
    for (const d of due.filter((x) => !have.has(x))) {
      try {
        await prisma.transaction.create({
          data: {
            familyId: r.familyId,
            accountId: r.accountId,
            date: parseDay(d)!,
            amount: r.amount,
            type: r.type,
            categoryId: r.categoryId,
            memberId: r.memberId,
            merchant: r.name,
            notes: 'Recurring',
            recurringRuleId: r.id,
          },
        });
        created++;
      } catch (e) {
        // A concurrent run already created it (unique rule + date) — that's fine.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
  }
  return { created };
}

export const UpcomingQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

export async function upcoming(prisma: PrismaClient, familyId: string, days: number) {
  const from = addDays(today(), 1);
  const to = addDays(today(), days);
  const rules = await prisma.recurringRule.findMany({ where: { familyId, active: true }, include });
  return rules
    .flatMap((r) =>
      occurrences(asRule(r), maxDay(from, formatDay(r.generateFrom)), to).map((date) => ({
        ruleId: r.id,
        name: r.name,
        date,
        type: r.type,
        amount: Number(r.amount),
        currency: r.account.currency,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

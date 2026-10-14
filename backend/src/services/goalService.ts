import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { computeBalances, type BalanceTxn } from '../domain/balances.js';
import { CurrencySchema, convert, type Rate } from '../domain/currency.js';
import { goalProgress } from '../domain/goals.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertMember } from './ownership.js';
import { loadRates } from './rateService.js';
import { holdingValues } from './holdingService.js';

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const cents = z.number().int('Use whole cents').refine(Number.isSafeInteger, 'Amount is too large');
const LINK_KINDS = ['account', 'asset', 'holding'] as const;
type LinkKind = (typeof LINK_KINDS)[number];

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  targetAmount: cents.positive('Enter a target above zero'),
  currency: CurrencySchema,
  targetDate: day.nullable().optional(),
  memberId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['active', 'reached', 'archived']).optional(),
  links: z
    .array(z.object({ kind: z.enum(LINK_KINDS), id: z.uuid() }))
    .max(50)
    .optional(),
};
export const GoalCreate = z.object(fields);
export const GoalUpdate = z.object(fields).partial();
export const EntryInput = z.object({
  date: day.refine((d) => d <= todayLocal(), 'Entries cannot be in the future'),
  amount: cents.refine((n) => n !== 0, 'Enter an amount (negative = taken out)'),
  note: z.string().trim().max(200).nullable().optional(),
});

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const g = await prisma.goal.findFirst({ where: { id, familyId } });
  if (!g) throw notFound('Goal');
  return g;
}

/** Every link must point at this family's account or asset (others look missing: 404). */
async function checkLinks(
  prisma: PrismaClient,
  familyId: string,
  links: { kind: LinkKind; id: string }[],
) {
  const ids = (kind: LinkKind) => [
    ...new Set(links.filter((l) => l.kind === kind).map((l) => l.id)),
  ];
  const [accounts, assets, holdings] = await Promise.all([
    prisma.account.count({ where: { familyId, id: { in: ids('account') } } }),
    prisma.asset.count({ where: { familyId, id: { in: ids('asset') } } }),
    prisma.holding.count({ where: { familyId, id: { in: ids('holding') } } }),
  ]);
  if (accounts !== ids('account').length) throw notFound('Account');
  if (assets !== ids('asset').length) throw notFound('Asset');
  if (holdings !== ids('holding').length) throw notFound('Holding');
}

const dedupe = (links: { kind: LinkKind; id: string }[]) => [
  ...new Map(links.map((l) => [`${l.kind}:${l.id}`, l])).values(),
];

export async function createGoal(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof GoalCreate>,
) {
  if (input.memberId) await assertMember(prisma, familyId, input.memberId);
  const links = dedupe(input.links ?? []);
  await checkLinks(prisma, familyId, links);
  const { name, targetAmount, currency, memberId, note, status, targetDate } = input;
  const goal = await prisma.goal.create({
    data: {
      name,
      targetAmount,
      currency,
      memberId,
      note,
      status,
      familyId,
      targetDate: targetDate ? parseDay(targetDate) : null,
      links: { create: links.map((l) => ({ kind: l.kind, refId: l.id })) },
    },
  });
  return getGoal(prisma, familyId, goal.id);
}

export async function updateGoal(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof GoalUpdate>,
) {
  const existing = await owned(prisma, familyId, id);
  // Entries are amounts in the goal currency: switching would re-read them 1:1.
  if (
    input.currency &&
    input.currency !== existing.currency &&
    (await prisma.goalEntry.count({ where: { goalId: id } }))
  ) {
    throw new AppError(
      409,
      'CURRENCY_LOCKED',
      'The currency cannot be changed once the goal has entries',
    );
  }
  if (input.memberId) await assertMember(prisma, familyId, input.memberId);
  const { links, targetDate, ...rest } = input;
  if (links) await checkLinks(prisma, familyId, dedupe(links));
  await prisma.$transaction([
    prisma.goal.update({
      where: { id },
      data: {
        ...rest,
        ...(targetDate !== undefined && { targetDate: targetDate ? parseDay(targetDate) : null }),
      },
    }),
    ...(links
      ? [
          prisma.goalLink.deleteMany({ where: { goalId: id } }),
          prisma.goalLink.createMany({
            data: dedupe(links).map((l) => ({ goalId: id, kind: l.kind, refId: l.id })),
          }),
        ]
      : []),
  ]);
  return getGoal(prisma, familyId, id);
}

export async function deleteGoal(prisma: PrismaClient, familyId: string, id: string) {
  await owned(prisma, familyId, id);
  await prisma.goal.delete({ where: { id } });
}

export async function addEntry(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof EntryInput>,
) {
  await owned(prisma, familyId, id);
  await prisma.goalEntry.create({
    data: {
      goalId: id,
      date: parseDay(input.date)!,
      amount: input.amount,
      note: input.note ?? null,
    },
  });
  return getGoal(prisma, familyId, id);
}

export async function deleteEntry(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  entryId: string,
) {
  await owned(prisma, familyId, id);
  const { count } = await prisma.goalEntry.deleteMany({ where: { id: entryId, goalId: id } });
  if (!count) throw notFound('Entry');
  return getGoal(prisma, familyId, id);
}

async function getGoal(prisma: PrismaClient, familyId: string, id: string) {
  return (await listGoals(prisma, familyId)).find((g) => g.id === id)!;
}

type LinkView = {
  kind: LinkKind;
  id: string;
  name: string;
  currency: string;
  /** today, in its own currency */
  amount: number;
  /** about 3 months ago */
  before: number;
};

const STATUS_ORDER: Record<string, number> = { active: 0, reached: 1, archived: 2 };

/** All goals with what they count, what is saved and how they are doing. */
export async function listGoals(prisma: PrismaClient, familyId: string) {
  const goals = await prisma.goal.findMany({
    where: { familyId },
    include: { links: true, entries: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] } },
  });
  // The dashboard asks on every visit; without goals there is nothing else to load.
  if (goals.length === 0) return [];
  const today = todayLocal();
  const before = addDays(today, -91); // about 3 months ago, for the pace
  const [accounts, txns, assets, rates, holdingsNow, holdingsBefore] = await Promise.all([
    prisma.account.findMany({ where: { familyId } }),
    prisma.transaction.findMany({
      where: { familyId },
      select: {
        accountId: true,
        type: true,
        amount: true,
        transferAccountId: true,
        transferAmount: true,
        date: true,
      },
    }),
    prisma.asset.findMany({
      where: { familyId },
      include: { valuations: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] } },
    }),
    loadRates(prisma, familyId),
    // Archived holdings keep counting towards goals, like archived accounts.
    holdingValues(prisma, familyId, today, { includeArchived: true }),
    holdingValues(prisma, familyId, before, { includeArchived: true }),
  ]);
  const holdingBefore = new Map(holdingsBefore.map((h) => [h.id, h.value ?? 0]));
  const balanceTxns = txns.map((t) => ({
    ...t,
    type: t.type as BalanceTxn['type'],
    amount: Number(t.amount),
    transferAmount: t.transferAmount === null ? null : Number(t.transferAmount),
  }));
  const opening = accounts.map((a) => ({ id: a.id, openingBalance: Number(a.openingBalance) }));
  const balancesOn = (date: string) => {
    const end = parseDay(addDays(date, 1))!;
    return computeBalances(
      opening,
      balanceTxns.filter((t) => t.date < end),
    );
  };
  const balancesToday = balancesOn(today);
  const balancesBefore = balancesOn(before);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetValueOn = (assetId: string, date: string) => {
    const valuations = assetById.get(assetId)?.valuations ?? [];
    // Before its first valuation an asset counts with that first value (like an account's
    // opening balance), so entering an existing asset today is not "saved" money.
    const v = valuations.find((x) => formatDay(x.date) <= date) ?? valuations.at(-1);
    return v ? Number(v.value) : null;
  };

  return goals
    .map((g) => {
      const links = g.links.flatMap((l): LinkView[] => {
        if (l.kind === 'account') {
          const a = accountById.get(l.refId);
          if (!a) return [];
          return [
            {
              kind: 'account' as const,
              id: a.id,
              name: a.name,
              currency: a.currency,
              amount: balancesToday.get(a.id) ?? 0,
              before: balancesBefore.get(a.id) ?? 0,
            },
          ];
        }
        if (l.kind === 'holding') {
          const h = holdingsNow.find((x) => x.id === l.refId);
          if (!h) return [];
          return [
            {
              kind: 'holding' as const,
              id: h.id,
              name: h.name,
              currency: h.currency,
              amount: h.value ?? 0,
              before: holdingBefore.get(h.id) ?? 0,
            },
          ];
        }
        const a = assetById.get(l.refId);
        if (!a) return [];
        return [
          {
            kind: 'asset' as const,
            id: a.id,
            name: a.name,
            currency: a.currency,
            amount: assetValueOn(a.id, today) ?? 0,
            before: assetValueOn(a.id, before) ?? 0,
          },
        ];
      });
      const entries = g.entries.map((e) => ({
        id: e.id,
        date: formatDay(e.date),
        amount: Number(e.amount),
        note: e.note,
      }));
      const savedOn = (date: string, pick: 'amount' | 'before', rates: Rate[], rateDay = date) => {
        let total = entries.filter((e) => e.date <= date).reduce((s, e) => s + e.amount, 0);
        const unconverted = new Map<string, number>();
        for (const l of links) {
          const v = convert(l[pick], l.currency, g.currency, rateDay.slice(0, 7), rates);
          if (v === null) unconverted.set(l.currency, (unconverted.get(l.currency) ?? 0) + l[pick]);
          else total += v;
        }
        return { total, unconverted };
      };
      const now = savedOn(today, 'amount', rates);
      // For the pace, both dates use today's rates: only real saving moves it, never a rate that
      // is missing (or different) for the earlier month. Unconvertible links are left out of both.
      const then = savedOn(before, 'before', rates, today);
      const targetDate = g.targetDate ? formatDay(g.targetDate) : null;
      return {
        id: g.id,
        name: g.name,
        targetAmount: Number(g.targetAmount),
        currency: g.currency,
        targetDate,
        memberId: g.memberId,
        note: g.note,
        status: g.status as 'active' | 'reached' | 'archived',
        links: links.map(({ before: _b, ...l }) => l),
        entries,
        saved: now.total,
        unconverted: [...now.unconverted].map(([currency, amount]) => ({ currency, amount })),
        progress: goalProgress({
          target: Number(g.targetAmount),
          saved: now.total,
          savedBefore: then.total,
          today,
          targetDate,
        }),
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]! ||
        (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') ||
        a.name.localeCompare(b.name),
    );
}

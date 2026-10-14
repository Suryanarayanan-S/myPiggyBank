import type { PrismaClient } from '@prisma/client';
import type { Db } from '../lib/db.js';
import { z } from 'zod';
import { CurrencySchema } from '../domain/currency.js';

const pct = z.number().int('Use whole percents').min(0).max(100);
// Labels the pages already use for other figures.
const RESERVED = ['net income', 'spent', 'unused', 'uncategorised', 'savings rate', 'income'];
const bucketName = z
  .string()
  .trim()
  .min(1, 'Give the bucket a name')
  .max(30)
  .refine(
    (n) => !RESERVED.includes(n.toLowerCase()),
    'That name is already used for something else',
  );

export const FamilyInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  spendingCurrency: CurrencySchema.optional(),
  wealthCurrency: CurrencySchema.optional(),
  rateMode: z.enum(['manual', 'live']).optional(),
  targets: z
    .object({ essentials: pct, fun: pct, future: pct })
    .refine((t) => t.essentials + t.fun + t.future === 100, 'Targets must add up to 100 %')
    .optional(),
  extras: z
    .strictObject({
      quickEntrySuggestions: z.boolean().optional(),
    })
    .refine((o) => Object.keys(o).length > 0, 'Choose a setting to change')
    .optional(),
  bucketNames: z
    .object({ essentials: bucketName, fun: bucketName, future: bucketName })
    .refine(
      (n) => new Set([n.essentials, n.fun, n.future].map((x) => x.toLowerCase())).size === 3,
      'Give each bucket its own name',
    )
    .optional(),
});

const select = {
  id: true,
  name: true,
  spendingCurrency: true,
  wealthCurrency: true,
  rateMode: true,
  targetEssentials: true,
  targetFun: true,
  targetFuture: true,
  nameEssentials: true,
  nameFun: true,
  nameFuture: true,
  quickEntryHints: true,
} as const;

type Row = {
  id: string;
  name: string;
  spendingCurrency: string;
  wealthCurrency: string;
  rateMode: string;
} & Record<'targetEssentials' | 'targetFun' | 'targetFuture', number> &
  Record<'nameEssentials' | 'nameFun' | 'nameFuture', string> &
  Record<'quickEntryHints', boolean>;

const toDto = (f: Row) => ({
  id: f.id,
  name: f.name,
  spendingCurrency: f.spendingCurrency,
  wealthCurrency: f.wealthCurrency,
  rateMode: f.rateMode as 'manual' | 'live',
  targets: { essentials: f.targetEssentials, fun: f.targetFun, future: f.targetFuture },
  bucketNames: { essentials: f.nameEssentials, fun: f.nameFun, future: f.nameFuture },
  extras: { quickEntrySuggestions: f.quickEntryHints },
});
export type FamilyDto = ReturnType<typeof toDto>;

export async function getFamily(prisma: Db, familyId: string) {
  return toDto(await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select }));
}

export async function updateFamily(
  prisma: PrismaClient,
  familyId: string,
  { targets, bucketNames, extras, ...rest }: z.output<typeof FamilyInput>,
) {
  const data = {
    ...rest,
    ...(targets && {
      targetEssentials: targets.essentials,
      targetFun: targets.fun,
      targetFuture: targets.future,
    }),
    ...(extras?.quickEntrySuggestions !== undefined && {
      quickEntryHints: extras.quickEntrySuggestions,
    }),
    ...(bucketNames && {
      nameEssentials: bucketNames.essentials,
      nameFun: bucketNames.fun,
      nameFuture: bucketNames.future,
    }),
  };
  return toDto(await prisma.family.update({ where: { id: familyId }, data, select }));
}

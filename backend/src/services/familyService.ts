import type { PrismaClient } from '@prisma/client';
import type { Db } from '../lib/db.js';
import { z } from 'zod';
import { CurrencySchema } from '../domain/currency.js';

const pct = z.number().int('Use whole percents').min(0).max(100);

export const FamilyInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  spendingCurrency: CurrencySchema.optional(),
  wealthCurrency: CurrencySchema.optional(),
  targets: z
    .object({ essentials: pct, fun: pct, future: pct })
    .refine((t) => t.essentials + t.fun + t.future === 100, 'Targets must add up to 100 %')
    .optional(),
});

const select = {
  id: true,
  name: true,
  spendingCurrency: true,
  wealthCurrency: true,
  targetEssentials: true,
  targetFun: true,
  targetFuture: true,
} as const;

type Row = { id: string; name: string; spendingCurrency: string; wealthCurrency: string } & Record<
  'targetEssentials' | 'targetFun' | 'targetFuture',
  number
>;

const toDto = (f: Row) => ({
  id: f.id,
  name: f.name,
  spendingCurrency: f.spendingCurrency,
  wealthCurrency: f.wealthCurrency,
  targets: { essentials: f.targetEssentials, fun: f.targetFun, future: f.targetFuture },
});
export type FamilyDto = ReturnType<typeof toDto>;

export async function getFamily(prisma: Db, familyId: string) {
  return toDto(await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select }));
}

export async function updateFamily(
  prisma: PrismaClient,
  familyId: string,
  { targets, ...rest }: z.output<typeof FamilyInput>,
) {
  const data = {
    ...rest,
    ...(targets && {
      targetEssentials: targets.essentials,
      targetFun: targets.fun,
      targetFuture: targets.future,
    }),
  };
  return toDto(await prisma.family.update({ where: { id: familyId }, data, select }));
}

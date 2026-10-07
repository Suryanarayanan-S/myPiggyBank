import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema } from '../domain/currency.js';

export const FamilyInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100).optional(),
  spendingCurrency: CurrencySchema.optional(),
  wealthCurrency: CurrencySchema.optional(),
});

const select = { id: true, name: true, spendingCurrency: true, wealthCurrency: true } as const;

export function getFamily(prisma: PrismaClient, familyId: string) {
  return prisma.family.findUniqueOrThrow({ where: { id: familyId }, select });
}

export function updateFamily(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof FamilyInput>,
) {
  return prisma.family.update({ where: { id: familyId }, data: input, select });
}

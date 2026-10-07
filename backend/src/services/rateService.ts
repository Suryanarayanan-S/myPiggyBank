import type { ExchangeRate, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, formatRate, parseRate } from '../domain/currency.js';
import { notFound } from '../lib/errors.js';

export const RateInput = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month as YYYY-MM'),
    base: CurrencySchema,
    quote: CurrencySchema,
    rate: z.string().refine((s) => parseRate(s) !== null, 'Enter a positive rate, e.g. 97.85'),
  })
  .refine((r) => r.base !== r.quote, {
    message: 'Choose two different currencies',
    path: ['quote'],
  });

export type RateDto = { id: string; month: string; base: string; quote: string; rate: string };
const toDto = (r: ExchangeRate): RateDto => ({
  id: r.id,
  month: r.month,
  base: r.base,
  quote: r.quote,
  rate: formatRate(r.rateMicros),
});

export async function listRates(prisma: PrismaClient, familyId: string) {
  const rates = await prisma.exchangeRate.findMany({
    where: { familyId },
    orderBy: [{ month: 'desc' }, { base: 'asc' }, { quote: 'asc' }],
  });
  return rates.map(toDto);
}

export async function upsertRate(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof RateInput>,
) {
  const { month, base, quote } = input;
  const rateMicros = parseRate(input.rate)!;
  const row = await prisma.exchangeRate.upsert({
    where: { familyId_month_base_quote: { familyId, month, base, quote } },
    create: { familyId, month, base, quote, rateMicros },
    update: { rateMicros },
  });
  return toDto(row);
}

export async function deleteRate(prisma: PrismaClient, familyId: string, id: string) {
  const { count } = await prisma.exchangeRate.deleteMany({ where: { id, familyId } });
  if (!count) throw notFound('Exchange rate');
}

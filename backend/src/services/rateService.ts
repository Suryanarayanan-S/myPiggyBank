import type { ExchangeRate, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  CurrencySchema,
  expandLiveRates,
  formatRate,
  mergeRates,
  parseRate,
  type Rate,
} from '../domain/currency.js';
import { notFound } from '../lib/errors.js';

// rateMicros is a 32-bit column; 2000 covers every supported pair (e.g. GBP→INR ≈ 110).
const MAX_RATE_MICROS = 2_000_000_000;

export const RateInput = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month as YYYY-MM'),
    base: CurrencySchema,
    quote: CurrencySchema,
    rate: z
      .string()
      .refine((s) => parseRate(s) !== null, 'Enter a positive rate, e.g. 97.85')
      .refine((s) => (parseRate(s) ?? 0) <= MAX_RATE_MICROS, 'Rate must be at most 2000'),
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

const rateSelect = { month: true, base: true, quote: true, rateMicros: true } as const;

/** The rates conversions use: hand-entered ones, plus live ones when the family chose live mode. */
export async function loadRates(prisma: PrismaClient, familyId: string): Promise<Rate[]> {
  const [family, manual] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { rateMode: true } }),
    prisma.exchangeRate.findMany({ where: { familyId }, select: rateSelect }),
  ]);
  if (family.rateMode !== 'live') return manual;
  const live = await prisma.liveRate.findMany({
    select: { month: true, quote: true, rateMicros: true },
  });
  return mergeRates(manual, expandLiveRates(live));
}

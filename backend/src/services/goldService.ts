import type { GoldItem, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { convert, formatRate } from '../domain/currency.js';
import { PURITIES, goldValue, parseGrams, type Purity } from '../domain/gold.js';
import { formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { assertMember } from './ownership.js';
import { loadRates } from './rateService.js';

/** Gold is priced in rupees (IBJA). */
const CURRENCY = 'INR';
const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const pastDay = day.refine((d) => d <= todayLocal(), 'The date cannot be in the future');
const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  ownerMemberId: z.uuid().nullable().optional(),
  grams: z.string().refine((s) => parseGrams(s) !== null, 'Enter the weight in grams, e.g. 12.5'),
  purity: z.enum(PURITIES),
  boughtOn: pastDay.nullable().optional(),
  boughtFor: z
    .number()
    .int('Use whole paise')
    .positive('Enter an amount above zero')
    .refine(Number.isSafeInteger)
    .nullable()
    .optional(),
  note: z.string().trim().max(500).nullable().optional(),
};
const notGoneBeforeBought = (g: { boughtOn?: string | null; closedAt?: string | null }) =>
  !g.boughtOn || !g.closedAt || g.closedAt >= g.boughtOn;
const GONE_AFTER = { message: 'It cannot be gone before it was bought', path: ['closedAt'] };
/** Gold already sold can be recorded in one go (with the day it went). */
export const GoldCreate = z
  .object({ ...fields, closedAt: pastDay.nullable().optional() })
  .refine(notGoneBeforeBought, GONE_AFTER);
export const GoldUpdate = z.object({ ...fields, closedAt: day.nullable() }).partial();

/**
 * The latest IBJA rate for 999 gold (collected with the daily prices) on or before a day. For a
 * day before the first one collected, that first rate: gold held then was not worth nothing
 * (like an asset counts with its first valuation before it).
 */
async function rateOn(prisma: PrismaClient, onDay: string) {
  const p =
    (await prisma.benchmarkPoint.findFirst({
      where: { series: 'gold24k', date: { lte: parseDay(onDay)! } },
      orderBy: { date: 'desc' },
    })) ??
    (await prisma.benchmarkPoint.findFirst({
      where: { series: 'gold24k' },
      orderBy: { date: 'asc' },
    }));
  return p ? { date: formatDay(p.date), micros: Number(p.value) } : null;
}
/** A rate older than this is shown as out of date (the daily download may be switched off). */
const STALE_DAYS = 7;

const heldOn = (g: GoldItem, onDay: string) => !g.closedAt || formatDay(g.closedAt) > onDay;

function dto(g: GoldItem, rate: number | null, today = todayLocal()) {
  const held = heldOn(g, today);
  const value = held && rate !== null ? goldValue(g.milligrams, g.purity as Purity, rate) : null;
  const boughtFor = g.boughtFor === null ? null : Number(g.boughtFor);
  return {
    id: g.id,
    name: g.name,
    ownerMemberId: g.ownerMemberId,
    grams: formatRate(g.milligrams * 1_000),
    purity: g.purity as Purity,
    boughtOn: g.boughtOn ? formatDay(g.boughtOn) : null,
    boughtFor,
    closedAt: g.closedAt ? formatDay(g.closedAt) : null,
    note: g.note,
    currency: CURRENCY,
    /** worth today at the latest rate; null without a rate or once no longer held */
    value,
    gain: value !== null && boughtFor !== null ? value - boughtFor : null,
    status: held ? ('held' as const) : ('closed' as const),
  };
}

/** The family's gold with its value, the rate used, and totals in one currency. */
export async function listGold(prisma: PrismaClient, familyId: string, view?: string) {
  const today = todayLocal();
  const [rows, family, rates, rate] = await Promise.all([
    prisma.goldItem.findMany({
      where: { familyId },
      orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    }),
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    rateOn(prisma, today),
  ]);
  const items = rows.map((g) => dto(g, rate?.micros ?? null, today));
  const currency = view ?? family.wealthCurrency;
  const held = items.filter((i) => i.status === 'held');
  const inRupees = held.reduce((t, i) => t + (i.value ?? 0), 0);
  const value = convert(inRupees, CURRENCY, currency, today.slice(0, 7), rates);
  const mg = rows.filter((g) => heldOn(g, today)).reduce((t, g) => t + g.milligrams, 0);
  return {
    items,
    rate: rate && {
      date: rate.date,
      perGram24k: rate.micros / 1_000_000,
      stale: Date.parse(today) - Date.parse(rate.date) > STALE_DAYS * 86_400_000,
    },
    summary: {
      currency,
      value: value ?? 0,
      unconverted: value === null && inRupees ? [{ currency: CURRENCY, amount: inRupees }] : [],
      grams: formatRate(mg * 1_000),
    },
  };
}

/** For net worth and goals: each piece held at its value (or what was paid, if so chosen). */
export async function goldValues(prisma: PrismaClient, familyId: string, onDay = todayLocal()) {
  const [rows, family, rate] = await Promise.all([
    prisma.goldItem.findMany({ where: { familyId } }),
    getFamily(prisma, familyId),
    rateOn(prisma, onDay),
  ]);
  const atCost = family.investmentsAt === 'invested';
  return rows.map((g) => {
    const value =
      !heldOn(g, onDay) || (g.boughtOn && formatDay(g.boughtOn) > onDay)
        ? null
        : atCost && g.boughtFor !== null
          ? Number(g.boughtFor)
          : rate
            ? goldValue(g.milligrams, g.purity as Purity, rate.micros)
            : null;
    return {
      id: g.id,
      name: g.name,
      currency: CURRENCY,
      ownerMemberId: g.ownerMemberId,
      assetClass: 'investment',
      value,
    };
  });
}

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const g = await prisma.goldItem.findFirst({ where: { id, familyId } });
  if (!g) throw notFound('Gold');
  return g;
}

const data = (input: z.output<typeof GoldUpdate>) => {
  const { grams, boughtOn, boughtFor, closedAt, ...rest } = input;
  return {
    ...rest,
    ...(grams !== undefined && { milligrams: parseGrams(grams)! }),
    ...(boughtOn !== undefined && { boughtOn: boughtOn ? parseDay(boughtOn) : null }),
    ...(boughtFor !== undefined && {
      boughtFor: boughtFor === null ? null : BigInt(boughtFor),
    }),
    ...(closedAt !== undefined && { closedAt: closedAt ? parseDay(closedAt) : null }),
  };
};

export async function createGold(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof GoldCreate>,
) {
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  const g = await prisma.goldItem.create({
    data: {
      ...data(input),
      name: input.name,
      purity: input.purity,
      milligrams: parseGrams(input.grams)!,
      familyId,
    },
  });
  return dto(g, (await rateOn(prisma, todayLocal()))?.micros ?? null);
}

export async function updateGold(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof GoldUpdate>,
) {
  const g = await owned(prisma, familyId, id);
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  const bought =
    input.boughtOn === undefined ? g.boughtOn && formatDay(g.boughtOn) : input.boughtOn;
  const closed =
    input.closedAt === undefined ? g.closedAt && formatDay(g.closedAt) : input.closedAt;
  if (bought && closed && closed < bought) {
    throw new AppError(400, 'VALIDATION_ERROR', 'It cannot be gone before it was bought');
  }
  const updated = await prisma.goldItem.update({ where: { id }, data: data(input) });
  return dto(updated, (await rateOn(prisma, todayLocal()))?.micros ?? null);
}

export async function deleteGold(prisma: PrismaClient, familyId: string, id: string) {
  await owned(prisma, familyId, id);
  await prisma.goldItem.delete({ where: { id } });
}

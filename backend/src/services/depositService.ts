import type { Deposit, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, convert } from '../domain/currency.js';
import {
  COMPOUNDING,
  depositValue,
  maturityAmount,
  payoutPerPeriod,
  type DepositTerms,
} from '../domain/deposits.js';
import { formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { assertAccount, assertMember } from './ownership.js';
import { loadRates } from './rateService.js';

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  principal: z
    .number()
    .int('Use whole cents')
    .positive('Enter an amount above zero')
    .refine(Number.isSafeInteger, 'Amount is too large'),
  rateBp: z
    .number()
    .int()
    .min(1, 'Enter the yearly rate, e.g. 7.25')
    .max(5_000, 'Enter the yearly rate in %, e.g. 7.25'),
  startDate: day,
  maturityDate: day,
  compounding: z.enum(COMPOUNDING),
  interest: z.enum(['reinvest', 'payout']),
  note: z.string().trim().max(500).nullable().optional(),
};
const after = (d: { startDate?: string; maturityDate?: string }) =>
  !d.startDate || !d.maturityDate || d.maturityDate > d.startDate;
const MATURES_AFTER = {
  message: 'The maturity date must be after the start',
  path: ['maturityDate'],
};
export const DepositCreate = z.object(fields).refine(after, MATURES_AFTER);
export const DepositUpdate = z
  .object({ ...fields, closedAt: day.nullable() })
  .partial()
  .refine(after, MATURES_AFTER);

const terms = (d: Deposit): DepositTerms => ({
  principal: Number(d.principal),
  rateBp: d.rateBp,
  start: formatDay(d.startDate),
  maturity: formatDay(d.maturityDate),
  compounding: d.compounding as DepositTerms['compounding'],
  interest: d.interest as DepositTerms['interest'],
});

/** Closed (paid out) by `onDay`: no longer counted. */
const closedBy = (d: Deposit, onDay: string) => !!d.closedAt && formatDay(d.closedAt) <= onDay;

function dto(d: Deposit, today = todayLocal()) {
  const t = terms(d);
  const value = closedBy(d, today) ? null : depositValue(t, today);
  const daysLeft = Math.round((Date.parse(t.maturity) - Date.parse(today)) / 86_400_000);
  return {
    id: d.id,
    kind: d.kind,
    name: d.name,
    currency: d.currency,
    ownerMemberId: d.ownerMemberId,
    accountId: d.accountId,
    principal: t.principal,
    rateBp: d.rateBp,
    startDate: t.start,
    maturityDate: t.maturity,
    compounding: t.compounding,
    interest: t.interest,
    closedAt: d.closedAt ? formatDay(d.closedAt) : null,
    note: d.note,
    /** worth today (principal plus interest so far); null once closed or before it starts */
    value,
    interestEarned: value === null ? null : value - t.principal,
    maturityAmount: maturityAmount(t),
    /** for deposits that pay interest out: each period's payment */
    payoutPerPeriod: t.interest === 'payout' ? payoutPerPeriod(t) : null,
    daysLeft,
    status: closedBy(d, today)
      ? ('closed' as const)
      : today < t.start
        ? ('upcoming' as const)
        : daysLeft <= 0
          ? ('matured' as const)
          : ('active' as const),
  };
}

/** Deposits with their value, plus totals in one currency (default: the wealth currency). */
export async function listDeposits(prisma: PrismaClient, familyId: string, view?: string) {
  const [rows, family, rates] = await Promise.all([
    prisma.deposit.findMany({
      where: { familyId },
      orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { maturityDate: 'asc' }],
    }),
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
  ]);
  const currency = view ?? family.wealthCurrency;
  const month = todayLocal().slice(0, 7);
  const deposits = rows.map((d) => dto(d));
  const sum = { value: 0, principal: 0 };
  const unconverted = new Map<string, number>();
  const withView = deposits.map((d) => {
    if (d.value === null) return { ...d, inView: null };
    const value = convert(d.value, d.currency, currency, month, rates);
    const principal = convert(d.principal, d.currency, currency, month, rates);
    if (value === null || principal === null) {
      unconverted.set(d.currency, (unconverted.get(d.currency) ?? 0) + d.value);
      return { ...d, inView: null };
    }
    sum.value += value;
    sum.principal += principal;
    return { ...d, inView: { value, principal } };
  });
  return {
    deposits: withView,
    summary: {
      currency,
      ...sum,
      unconverted: [...unconverted].map(([c, amount]) => ({ currency: c, amount })),
    },
  };
}

/** For net worth: each open deposit at its value today (or what was put in, if so chosen). */
export async function depositValues(prisma: PrismaClient, familyId: string, onDay = todayLocal()) {
  const [rows, family] = await Promise.all([
    prisma.deposit.findMany({ where: { familyId } }),
    getFamily(prisma, familyId),
  ]);
  const atCost = family.investmentsAt === 'invested';
  return rows.map((d) => {
    const value = closedBy(d, onDay) ? null : depositValue(terms(d), onDay);
    return {
      id: d.id,
      name: d.name,
      currency: d.currency,
      ownerMemberId: d.ownerMemberId,
      assetClass: 'investment',
      value: value === null ? null : atCost ? Number(d.principal) : value,
    };
  });
}

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const d = await prisma.deposit.findFirst({ where: { id, familyId } });
  if (!d) throw notFound('Deposit');
  return d;
}

/** Owner and account belong to the family; the account holds the deposit's currency. */
async function check(
  prisma: PrismaClient,
  familyId: string,
  next: { ownerMemberId?: string | null; accountId?: string | null; currency: string },
) {
  if (next.ownerMemberId) await assertMember(prisma, familyId, next.ownerMemberId);
  if (next.accountId) {
    const a = await assertAccount(prisma, familyId, next.accountId);
    if (a.currency !== next.currency) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `The account holds ${a.currency}: the deposit must be in the same currency`,
      );
    }
  }
}

const dates = (input: { startDate?: string; maturityDate?: string }) => ({
  ...(input.startDate && { startDate: parseDay(input.startDate)! }),
  ...(input.maturityDate && { maturityDate: parseDay(input.maturityDate)! }),
});

export async function createDeposit(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof DepositCreate>,
) {
  await check(prisma, familyId, input);
  const d = await prisma.deposit.create({
    data: { ...input, ...dates(input), principal: BigInt(input.principal), familyId },
  });
  return dto(d);
}

export async function updateDeposit(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof DepositUpdate>,
) {
  const d = await owned(prisma, familyId, id);
  const next = {
    currency: input.currency ?? d.currency,
    accountId: input.accountId === undefined ? d.accountId : input.accountId,
    ownerMemberId: input.ownerMemberId,
  };
  await check(prisma, familyId, next);
  const start = input.startDate ?? formatDay(d.startDate);
  const maturity = input.maturityDate ?? formatDay(d.maturityDate);
  if (maturity <= start) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The maturity date must be after the start');
  }
  const closed =
    input.closedAt === undefined ? d.closedAt && formatDay(d.closedAt) : input.closedAt;
  if (closed && closed < start) {
    throw new AppError(400, 'VALIDATION_ERROR', 'It cannot be paid out before it started');
  }
  const { closedAt, principal, ...rest } = input;
  const updated = await prisma.deposit.update({
    where: { id },
    data: {
      ...rest,
      ...dates(input),
      ...(principal !== undefined && { principal: BigInt(principal) }),
      ...(closedAt !== undefined && { closedAt: closedAt === null ? null : parseDay(closedAt)! }),
    },
  });
  return dto(updated);
}

export async function deleteDeposit(prisma: PrismaClient, familyId: string, id: string) {
  await owned(prisma, familyId, id);
  await prisma.deposit.delete({ where: { id } });
}

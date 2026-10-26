import type { Deposit, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, convert } from '../domain/currency.js';
import {
  COMPOUNDING,
  addMonths,
  depositValue,
  instalmentsDue,
  maturityAmount,
  payoutPerPeriod,
  recurringMaturity,
  recurringValue,
  type DepositTerms,
  type RecurringTerms,
} from '../domain/deposits.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { ASSET_CLASSES } from '../domain/networth.js';
import { assertAccount, assertCategory, assertMember } from './ownership.js';
import { loadRates } from './rateService.js';
import { createRecurring, deleteRecurring, updateRecurring } from './recurringService.js';

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  /** how net worth counts it (default: investment) */
  assetClass: z.enum(ASSET_CLASSES).optional(),
  /** a fixed deposit's amount; a recurring deposit's monthly instalment */
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
  compounding: z.enum(COMPOUNDING),
  note: z.string().trim().max(500).nullable().optional(),
  // fixed deposits
  maturityDate: day,
  interest: z.enum(['reinvest', 'payout']),
  // recurring deposits
  months: z.number().int().min(1, 'At least one month').max(120, 'At most 120 months'),
  /** book each instalment from the account (a monthly recurring expense), in this category */
  book: z.object({ categoryId: z.uuid().nullable() }).nullable(),
};
const after = (d: { startDate?: string; maturityDate?: string }) =>
  !d.startDate || !d.maturityDate || d.maturityDate > d.startDate;
const MATURES_AFTER = {
  message: 'The maturity date must be after the start',
  path: ['maturityDate'],
};
export const DepositCreate = z
  .object({ ...fields, kind: z.enum(['fd', 'rd']).default('fd') })
  .partial({ maturityDate: true, interest: true, months: true, book: true })
  .refine(after, MATURES_AFTER)
  .superRefine((d, ctx) => {
    const need = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    if (d.kind === 'fd') {
      if (!d.maturityDate) need('maturityDate', 'Enter the maturity date');
      if (!d.interest) need('interest', 'Say whether interest is added or paid out');
    } else if (!d.months) need('months', 'Enter for how many months');
  });
export const DepositUpdate = z
  .object({ ...fields, closedAt: day.nullable() })
  .partial()
  .refine(after, MATURES_AFTER);

/** Whole months from `start` to `maturity` (a recurring deposit's length). */
const monthsOf = (start: string, maturity: string) => {
  let m = 0;
  while (addMonths(start, m + 1) <= maturity) m++;
  return m;
};
const fdTerms = (d: Deposit): DepositTerms => ({
  principal: Number(d.principal),
  rateBp: d.rateBp,
  start: formatDay(d.startDate),
  maturity: formatDay(d.maturityDate),
  compounding: d.compounding as DepositTerms['compounding'],
  interest: d.interest as DepositTerms['interest'],
});
const rdTerms = (d: Deposit): RecurringTerms => ({
  instalment: Number(d.principal),
  rateBp: d.rateBp,
  start: formatDay(d.startDate),
  months: monthsOf(formatDay(d.startDate), formatDay(d.maturityDate)),
  compounding: d.compounding as RecurringTerms['compounding'],
});

/** Closed (paid out) by `onDay`: no longer counted. */
const closedBy = (d: Deposit, onDay: string) => !!d.closedAt && formatDay(d.closedAt) <= onDay;

/** Worth on a day and what has been put in by then (null before it starts or once closed). */
function worth(d: Deposit, onDay: string): { value: number; paidIn: number } | null {
  if (closedBy(d, onDay)) return null;
  if (d.kind === 'rd') {
    const t = rdTerms(d);
    const value = recurringValue(t, onDay);
    return value === null ? null : { value, paidIn: t.instalment * instalmentsDue(t, onDay) };
  }
  const value = depositValue(fdTerms(d), onDay);
  return value === null ? null : { value, paidIn: Number(d.principal) };
}

type Row = Deposit & { recurringRule: { categoryId: string | null; active: boolean } | null };

function dto(d: Row, today = todayLocal()) {
  const rd = d.kind === 'rd';
  const now = worth(d, today);
  const maturity = formatDay(d.maturityDate);
  const daysLeft = Math.round((Date.parse(maturity) - Date.parse(today)) / 86_400_000);
  const r = rd ? rdTerms(d) : null;
  return {
    id: d.id,
    kind: d.kind as 'fd' | 'rd',
    name: d.name,
    currency: d.currency,
    ownerMemberId: d.ownerMemberId,
    accountId: d.accountId,
    assetClass: d.assetClass as (typeof ASSET_CLASSES)[number],
    /** put in: a fixed deposit's amount; for a recurring one, the instalments due so far */
    principal: rd ? (now?.paidIn ?? 0) : Number(d.principal),
    rateBp: d.rateBp,
    startDate: formatDay(d.startDate),
    maturityDate: maturity,
    compounding: d.compounding as DepositTerms['compounding'],
    interest: d.interest as DepositTerms['interest'],
    closedAt: d.closedAt ? formatDay(d.closedAt) : null,
    note: d.note,
    /** worth today (put in plus interest so far); null once closed or before it starts */
    value: now?.value ?? null,
    interestEarned: now ? now.value - now.paidIn : null,
    maturityAmount: r ? recurringValue(r, recurringMaturity(r))! : maturityAmount(fdTerms(d)),
    /** for deposits that pay interest out: each period's payment */
    payoutPerPeriod: !rd && d.interest === 'payout' ? payoutPerPeriod(fdTerms(d)) : null,
    /** recurring deposits: the monthly instalment, how many, how many due so far */
    instalment: r ? r.instalment : null,
    months: r ? r.months : null,
    instalmentsDue: r
      ? instalmentsDue(
          r,
          d.closedAt && formatDay(d.closedAt) < today ? formatDay(d.closedAt) : today,
        )
      : null,
    /** booked from the account each month (the recurring rule's category) */
    book: d.recurringRule?.active ? { categoryId: d.recurringRule.categoryId } : null,
    daysLeft,
    status: closedBy(d, today)
      ? ('closed' as const)
      : today < formatDay(d.startDate)
        ? ('upcoming' as const)
        : daysLeft <= 0
          ? ('matured' as const)
          : ('active' as const),
  };
}

const withRule = { recurringRule: { select: { categoryId: true, active: true } } };

/** Deposits with their value, plus totals in one currency (default: the wealth currency). */
export async function listDeposits(prisma: PrismaClient, familyId: string, view?: string) {
  const [rows, family, rates] = await Promise.all([
    prisma.deposit.findMany({
      where: { familyId },
      include: withRule,
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

/** For net worth and goals: each open deposit at its value (or what was put in, if so chosen). */
export async function depositValues(prisma: PrismaClient, familyId: string, onDay = todayLocal()) {
  const [rows, family] = await Promise.all([
    prisma.deposit.findMany({ where: { familyId } }),
    getFamily(prisma, familyId),
  ]);
  const atCost = family.investmentsAt === 'invested';
  return rows.map((d) => {
    const w = worth(d, onDay);
    return {
      id: d.id,
      name: d.name,
      currency: d.currency,
      ownerMemberId: d.ownerMemberId,
      assetClass: d.assetClass,
      value: w === null ? null : atCost ? w.paidIn : w.value,
    };
  });
}

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const d = await prisma.deposit.findFirst({ where: { id, familyId }, include: withRule });
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

/** Booking needs an account, and an expense category (if one is chosen): checked before saving. */
async function checkBooking(
  prisma: PrismaClient,
  familyId: string,
  accountId: string | null | undefined,
  categoryId: string | null,
) {
  if (!accountId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose the account the instalment is paid from');
  }
  if (categoryId) {
    const c = await assertCategory(prisma, familyId, categoryId);
    if (c.kind !== 'expense') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Choose an expense category for the instalment');
    }
  }
}

/** The monthly rule that books a recurring deposit's instalment from its account. */
const ruleFor = (d: {
  name: string;
  principal: bigint | number;
  accountId: string | null;
  ownerMemberId: string | null;
  startDate: Date;
  maturityDate: Date;
}) => {
  if (!d.accountId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose the account the instalment is paid from');
  }
  const start = formatDay(d.startDate);
  return {
    name: `RD: ${d.name}`.slice(0, 80),
    amount: Number(d.principal),
    accountId: d.accountId,
    memberId: d.ownerMemberId,
    // the last instalment, counted from the start (31 Mar + 5 months is 31 Aug, not 30 Aug)
    endDate: addMonths(start, monthsOf(start, formatDay(d.maturityDate)) - 1),
  };
};

export async function createDeposit(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof DepositCreate>,
) {
  await check(prisma, familyId, input);
  const rd = input.kind === 'rd';
  const { book, months, ...rest } = input;
  const maturityDate = rd
    ? recurringMaturity({
        instalment: input.principal,
        rateBp: input.rateBp,
        start: input.startDate,
        months: months!,
        compounding: input.compounding,
      })
    : input.maturityDate!;
  const data = {
    ...rest,
    familyId,
    principal: BigInt(input.principal),
    startDate: parseDay(input.startDate)!,
    maturityDate: parseDay(maturityDate)!,
    interest: rd ? 'reinvest' : input.interest!,
  };
  if (rd && book) await checkBooking(prisma, familyId, data.accountId, book.categoryId);
  const d = await prisma.deposit.create({ data, include: withRule });
  if (rd && book) {
    try {
      const rule = await createRecurring(prisma, familyId, {
        ...ruleFor({ ...d }),
        type: 'expense',
        categoryId: book.categoryId,
        frequency: 'monthly',
        startDate: input.startDate,
      });
      await prisma.deposit.update({ where: { id: d.id }, data: { recurringRuleId: rule.id } });
    } catch (err) {
      await prisma.deposit.delete({ where: { id: d.id } }); // nothing half-made
      throw err;
    }
  }
  return dto(await owned(prisma, familyId, d.id));
}

export async function updateDeposit(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof DepositUpdate>,
) {
  const d = await owned(prisma, familyId, id);
  const rd = d.kind === 'rd';
  const next = {
    currency: input.currency ?? d.currency,
    accountId: input.accountId === undefined ? d.accountId : input.accountId,
    ownerMemberId: input.ownerMemberId,
  };
  await check(prisma, familyId, next);
  const start = input.startDate ?? formatDay(d.startDate);
  const maturity = rd
    ? addMonths(start, input.months ?? monthsOf(formatDay(d.startDate), formatDay(d.maturityDate)))
    : (input.maturityDate ?? formatDay(d.maturityDate));
  if (maturity <= start) {
    throw new AppError(400, 'VALIDATION_ERROR', 'The maturity date must be after the start');
  }
  const closed =
    input.closedAt === undefined ? d.closedAt && formatDay(d.closedAt) : input.closedAt;
  if (closed && closed < start) {
    throw new AppError(400, 'VALIDATION_ERROR', 'It cannot be paid out before it started');
  }
  // What the booking will be, checked before anything is written.
  const ruleId = d.recurringRule ? d.recurringRuleId : null;
  const wanted =
    !rd || input.book === null
      ? null
      : input.book !== undefined
        ? input.book
        : // unchanged: the running rule goes on (a rule paused on the Recurring page stays
          // paused, unless it stopped because the deposit was paid out and it is reopened)
          ruleId && (d.recurringRule!.active || (d.closedAt && input.closedAt === null))
          ? { categoryId: d.recurringRule!.categoryId }
          : null;
  if (wanted) await checkBooking(prisma, familyId, next.accountId, wanted.categoryId);
  if (rd) {
    const paid = instalmentsDue(rdTerms(d), todayLocal());
    if (monthsOf(start, maturity) < paid && formatDay(d.startDate) === start) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `${paid} instalments are already paid: it cannot be shorter`,
      );
    }
  }
  const { closedAt, principal, months: _months, book, maturityDate: _maturity, ...rest } = input;
  void _months;
  void _maturity;
  const updated = await prisma.deposit.update({
    where: { id },
    data: {
      ...rest,
      ...(input.startDate && { startDate: parseDay(input.startDate)! }),
      maturityDate: parseDay(maturity)!,
      ...(rd && { interest: 'reinvest' }),
      ...(principal !== undefined && { principal: BigInt(principal) }),
      ...(closedAt !== undefined && { closedAt: closedAt === null ? null : parseDay(closedAt)! }),
    },
    include: withRule,
  });
  if (rd) await syncRule(prisma, familyId, d, updated, book === null ? null : wanted);
  return dto(await owned(prisma, familyId, id));
}

/**
 * Keeps a recurring deposit's booking rule in step: created when asked for, removed when not
 * (past instalments stay booked), updated with the deposit, and stopped once it is paid out.
 */
async function syncRule(
  prisma: PrismaClient,
  familyId: string,
  before: Row,
  after: Deposit,
  book: { categoryId: string | null } | null | undefined,
) {
  const ruleId = before.recurringRuleId;
  if (ruleId && book === null) {
    await deleteRecurring(prisma, familyId, ruleId);
    return;
  }
  const wanted = book;
  if (!wanted) return;
  const rule = ruleFor(after);
  if (ruleId && after.accountId === before.accountId && +after.startDate === +before.startDate) {
    await updateRecurring(prisma, familyId, ruleId, {
      name: rule.name,
      amount: rule.amount,
      memberId: rule.memberId,
      categoryId: wanted.categoryId,
      endDate: rule.endDate,
      // paid out: no more instalments; reopened: they go on
      active: !after.closedAt,
    });
    return;
  }
  // New, or moved to another account or start: a new rule from tomorrow on (what was booked
  // stays booked, and today's instalment is never booked twice).
  if (ruleId) await deleteRecurring(prisma, familyId, ruleId);
  if (after.closedAt) {
    await prisma.deposit.update({ where: { id: after.id }, data: { recurringRuleId: null } });
    return;
  }
  const from =
    formatDay(after.startDate) > todayLocal()
      ? formatDay(after.startDate)
      : addDays(todayLocal(), 1);
  const created = await createRecurring(
    prisma,
    familyId,
    {
      ...rule,
      type: 'expense',
      categoryId: wanted.categoryId,
      frequency: 'monthly',
      startDate: formatDay(after.startDate),
    },
    from,
  );
  await prisma.deposit.update({ where: { id: after.id }, data: { recurringRuleId: created.id } });
}

export async function deleteDeposit(prisma: PrismaClient, familyId: string, id: string) {
  const d = await owned(prisma, familyId, id);
  await prisma.deposit.delete({ where: { id } });
  // its booking stops; the instalments already booked stay
  if (d.recurringRuleId) await deleteRecurring(prisma, familyId, d.recurringRuleId);
}

import type { Deposit, Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, convert } from '../domain/currency.js';
import {
  COMPOUNDING,
  addMonths,
  depositValue,
  instalmentsDue,
  matchScore,
  maturityAmount,
  payoutPerPeriod,
  recurringMaturity,
  recurringValue,
  rateOnDay,
  savingsValue,
  withKindSuffix,
  withoutKindSuffix,
  withRate,
  type DepositTerms,
  type RateFrom,
  type RecurringTerms,
} from '../domain/deposits.js';
import { fdFlows, rdFlows, savingsFlows } from '../domain/returns.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { ASSET_CLASSES } from '../domain/networth.js';
import { assertAccount, assertCategory, assertMember } from './ownership.js';
import { loadRates } from './rateService.js';
import { createRecurring, deleteRecurring, updateRecurring } from './recurringService.js';

const KINDS = ['fd', 'rd', 'savings'] as const;
const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  /** how net worth counts it (default: investment) */
  assetClass: z.enum(ASSET_CLASSES).optional(),
  /** a fixed deposit's amount; a recurring deposit's monthly instalment; savings: the opening
   * amount (may be zero: the money can come with linked transactions) */
  principal: z
    .number()
    .int('Use whole cents')
    .nonnegative('Enter an amount of zero or more')
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
const ids = z.array(z.uuid()).max(200);
const after = (d: { startDate?: string; maturityDate?: string }) =>
  !d.startDate || !d.maturityDate || d.maturityDate > d.startDate;
const MATURES_AFTER = {
  message: 'The maturity date must be after the start',
  path: ['maturityDate'],
};
export const DepositCreate = z
  .object({
    ...fields,
    kind: z.enum(KINDS).default('fd'),
    /** payments (or income) to link once it is saved, e.g. the one that opened it */
    transactionIds: ids,
  })
  .partial({ maturityDate: true, interest: true, months: true, book: true, transactionIds: true })
  .refine(after, MATURES_AFTER)
  .superRefine((d, ctx) => {
    const need = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    if (d.kind !== 'savings' && d.principal === 0) need('principal', 'Enter an amount above zero');
    if (d.kind === 'fd') {
      if (!d.maturityDate) need('maturityDate', 'Enter the maturity date');
      if (!d.interest) need('interest', 'Say whether interest is added or paid out');
    } else if (d.kind === 'rd' && !d.months) need('months', 'Enter for how many months');
  });
export const DepositUpdate = z
  .object({
    ...fields,
    closedAt: day.nullable(),
    /** instant-access savings: the day a new rate applies from (default: today) */
    rateFrom: day,
  })
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
  maturity: formatDay(d.maturityDate!),
  compounding: d.compounding as DepositTerms['compounding'],
  interest: d.interest as DepositTerms['interest'],
});
const rdTerms = (d: Deposit): RecurringTerms => ({
  instalment: Number(d.principal),
  rateBp: d.rateBp,
  start: formatDay(d.startDate),
  months: monthsOf(formatDay(d.startDate), formatDay(d.maturityDate!)),
  compounding: d.compounding as RecurringTerms['compounding'],
});
/** Its rates from each day on (one rate from the start, unless it was changed). */
const ratesOf = (d: Deposit): RateFrom[] =>
  d.rateHistory
    ? (JSON.parse(d.rateHistory) as RateFrom[])
    : [{ from: formatDay(d.startDate), rateBp: d.rateBp }];

/** Money into a deposit (> 0) and back out of it (< 0), from its linked transactions. */
export type Movement = {
  transactionId: string;
  date: string;
  amount: number;
  /** the payee or note, if any */
  label: string | null;
};
type MovementRow = {
  id: string;
  date: Date;
  amount: bigint;
  type: string;
  merchant: string | null;
  notes: string | null;
  depositId: string | null;
  recurringRuleId: string | null;
};
const movementSelect = {
  id: true,
  date: true,
  amount: true,
  type: true,
  merchant: true,
  notes: true,
  depositId: true,
  recurringRuleId: true,
} as const;
/** Each deposit's movements, newest first (a recurring deposit's booked instalments included). */
async function movementsOf(prisma: PrismaClient, familyId: string, deposits: Deposit[]) {
  const ruleOf = new Map(
    deposits.filter((d) => d.recurringRuleId).map((d) => [d.recurringRuleId!, d.id]),
  );
  const rows: MovementRow[] = await prisma.transaction.findMany({
    where: {
      familyId,
      type: { in: ['income', 'expense'] },
      OR: [
        { depositId: { in: deposits.map((d) => d.id) } },
        { recurringRuleId: { in: [...ruleOf.keys()] } },
      ],
    },
    select: movementSelect,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const byDeposit = new Map<string, Movement[]>();
  for (const t of rows) {
    const id = t.depositId ?? ruleOf.get(t.recurringRuleId!);
    if (!id) continue;
    const list = byDeposit.get(id) ?? [];
    list.push({
      transactionId: t.id,
      date: formatDay(t.date),
      amount: t.type === 'income' ? -Number(t.amount) : Number(t.amount),
      label: t.merchant ?? t.notes,
    });
    byDeposit.set(id, list);
  }
  return byDeposit;
}

/** Closed (paid out) by `onDay`: no longer counted. */
const closedBy = (d: Deposit, onDay: string) => !!d.closedAt && formatDay(d.closedAt) <= onDay;

/** Worth on a day and what has been put in by then (null before it starts or once closed). */
function worth(
  d: Deposit,
  onDay: string,
  moves: Movement[] = [],
): { value: number; paidIn: number } | null {
  if (closedBy(d, onDay)) return null;
  if (d.kind === 'savings') {
    return savingsValue(
      {
        opening: Number(d.principal),
        start: formatDay(d.startDate),
        rates: ratesOf(d),
        compounding: d.compounding as RecurringTerms['compounding'],
        movements: moves,
      },
      onDay,
    );
  }
  if (d.kind === 'rd') {
    const t = rdTerms(d);
    const value = recurringValue(t, onDay);
    return value === null ? null : { value, paidIn: t.instalment * instalmentsDue(t, onDay) };
  }
  const value = depositValue(fdTerms(d), onDay);
  return value === null ? null : { value, paidIn: Number(d.principal) };
}

type Row = Deposit & { recurringRule: { categoryId: string | null; active: boolean } | null };

function dto(d: Row, moves: Movement[] = [], today = todayLocal()) {
  const rd = d.kind === 'rd';
  const sv = d.kind === 'savings';
  const now = worth(d, today, moves);
  const maturity = d.maturityDate && formatDay(d.maturityDate);
  const daysLeft = maturity
    ? Math.round((Date.parse(maturity) - Date.parse(today)) / 86_400_000)
    : null;
  const r = rd ? rdTerms(d) : null;
  return {
    id: d.id,
    kind: d.kind as (typeof KINDS)[number],
    name: d.name,
    currency: d.currency,
    ownerMemberId: d.ownerMemberId,
    accountId: d.accountId,
    assetClass: d.assetClass as (typeof ASSET_CLASSES)[number],
    /** put in: a fixed deposit's amount; for a recurring one, the instalments due so far; for
     * savings, the opening amount plus money in less money out */
    principal: rd || sv ? (now?.paidIn ?? 0) : Number(d.principal),
    /** savings: the amount on the start day */
    opening: sv ? Number(d.principal) : null,
    rateBp: sv ? rateOnDay(ratesOf(d), today) : d.rateBp,
    startDate: formatDay(d.startDate),
    maturityDate: maturity,
    compounding: d.compounding as DepositTerms['compounding'],
    interest: d.interest as DepositTerms['interest'],
    closedAt: d.closedAt ? formatDay(d.closedAt) : null,
    note: d.note,
    /** worth today (put in plus interest so far); null once closed or before it starts */
    value: now?.value ?? null,
    interestEarned: now ? now.value - now.paidIn : null,
    /** null for savings, which never mature */
    maturityAmount: sv
      ? null
      : r
        ? recurringValue(r, recurringMaturity(r))!
        : maturityAmount(fdTerms(d)),
    /** for deposits that pay interest out: each period's payment */
    payoutPerPeriod:
      d.kind === 'fd' && d.interest === 'payout' ? payoutPerPeriod(fdTerms(d)) : null,
    /** savings: the rate from each day on (`rateBp` is today's) */
    rates: sv ? ratesOf(d) : null,
    /** the linked transactions, newest first */
    movements: moves,
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
        : daysLeft !== null && daysLeft <= 0
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
      orderBy: [
        { closedAt: { sort: 'asc', nulls: 'first' } },
        { maturityDate: { sort: 'asc', nulls: 'first' } },
        { startDate: 'asc' },
      ],
    }),
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
  ]);
  const currency = view ?? family.wealthCurrency;
  const month = todayLocal().slice(0, 7);
  const moves = await movementsOf(prisma, familyId, rows);
  const deposits = rows.map((d) => dto(d, moves.get(d.id)));
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
  const moves = await movementsOf(
    prisma,
    familyId,
    rows.filter((d) => d.kind === 'savings'),
  );
  return rows.map((d) => {
    const w = worth(d, onDay, moves.get(d.id));
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

/** For the value over time: each deposit's worth on each of `days` (0 before it starts or once
 * paid out). */
export async function depositSeries(prisma: PrismaClient, familyId: string, days: string[]) {
  const rows = await prisma.deposit.findMany({ where: { familyId } });
  const moves = await movementsOf(prisma, familyId, rows);
  return rows.map((d) => ({
    id: d.id,
    kind: d.kind as (typeof KINDS)[number],
    currency: d.currency,
    values: days.map((day) => worth(d, day, moves.get(d.id))?.value ?? 0),
  }));
}

/** For the returns: each deposit as cash flows and worth today (see domain/returns). */
export async function depositFlows(prisma: PrismaClient, familyId: string, today = todayLocal()) {
  const rows = await prisma.deposit.findMany({ where: { familyId } });
  const moves = await movementsOf(prisma, familyId, rows);
  return rows.map((d) => {
    const closedAt = d.closedAt ? formatDay(d.closedAt) : null;
    const f =
      d.kind === 'savings'
        ? savingsFlows(
            {
              opening: Number(d.principal),
              start: formatDay(d.startDate),
              rates: ratesOf(d),
              compounding: d.compounding as RecurringTerms['compounding'],
              movements: moves.get(d.id) ?? [],
            },
            closedAt,
            today,
          )
        : d.kind === 'rd'
          ? rdFlows(rdTerms(d), closedAt, today)
          : fdFlows(fdTerms(d), closedAt, today);
    return { kind: d.kind as (typeof KINDS)[number], name: d.name, currency: d.currency, ...f };
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
  maturityDate: Date | null;
}) => {
  if (!d.accountId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose the account the instalment is paid from');
  }
  const start = formatDay(d.startDate);
  return {
    name: d.name, // ends with RD
    amount: Number(d.principal),
    accountId: d.accountId,
    memberId: d.ownerMemberId,
    // the last instalment, counted from the start (31 Mar + 5 months is 31 Aug, not 30 Aug)
    endDate: addMonths(start, monthsOf(start, formatDay(d.maturityDate!)) - 1),
  };
};

export async function createDeposit(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof DepositCreate>,
) {
  await check(prisma, familyId, input);
  await checkLinks(prisma, familyId, input.currency, input.transactionIds ?? []);
  const rd = input.kind === 'rd';
  const sv = input.kind === 'savings';
  const { book, months, transactionIds, ...rest } = input;
  const maturityDate = sv
    ? null
    : rd
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
    maturityDate: maturityDate === null ? null : parseDay(maturityDate)!,
    interest: rd || sv ? 'reinvest' : input.interest!,
    // instant access is money at hand, unless said otherwise
    assetClass: input.assetClass ?? (sv ? 'liquid' : 'investment'),
    rateHistory: sv ? JSON.stringify([{ from: input.startDate, rateBp: input.rateBp }]) : null,
    name: withKindSuffix(input.name, input.kind),
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
  if (transactionIds?.length) {
    // only ones still free (checked above; another tab may have linked one since)
    const { count } = await prisma.transaction.updateMany({
      where: { familyId, id: { in: transactionIds }, depositId: null },
      data: { depositId: d.id },
    });
    if (count !== new Set(transactionIds).size) {
      await deleteDeposit(prisma, familyId, d.id); // nothing half-made
      throw new AppError(400, 'VALIDATION_ERROR', 'A transaction is linked to another deposit');
    }
  }
  return withMoves(prisma, familyId, d.id);
}

/** One deposit as listed, with its movements. */
async function withMoves(prisma: PrismaClient, familyId: string, id: string) {
  const d = await owned(prisma, familyId, id);
  return dto(d, (await movementsOf(prisma, familyId, [d])).get(id));
}

export async function updateDeposit(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof DepositUpdate>,
) {
  const d = await owned(prisma, familyId, id);
  const rd = d.kind === 'rd';
  const sv = d.kind === 'savings';
  if (!sv && input.principal === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Enter an amount above zero');
  }
  // linked transactions are in its currency
  if (
    input.currency &&
    input.currency !== d.currency &&
    (await prisma.transaction.count({ where: { depositId: id } })) > 0
  ) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'The currency cannot be changed while transactions are linked to it',
    );
  }
  const next = {
    currency: input.currency ?? d.currency,
    accountId: input.accountId === undefined ? d.accountId : input.accountId,
    ownerMemberId: input.ownerMemberId,
  };
  await check(prisma, familyId, next);
  const start = input.startDate ?? formatDay(d.startDate);
  const maturity = sv
    ? null
    : rd
      ? addMonths(
          start,
          input.months ?? monthsOf(formatDay(d.startDate), formatDay(d.maturityDate!)),
        )
      : (input.maturityDate ?? formatDay(d.maturityDate!));
  if (maturity !== null && maturity <= start) {
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
    if (monthsOf(start, maturity!) < paid && formatDay(d.startDate) === start) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `${paid} instalments are already paid: it cannot be shorter`,
      );
    }
  }
  const {
    closedAt,
    principal,
    months: _months,
    book,
    maturityDate: _maturity,
    rateFrom,
    ...rest
  } = input;
  void _months;
  void _maturity;
  // savings: a new rate applies from its day on; the earlier interest keeps the old one
  // (an edit that sends today's rate unchanged keeps a change planned for a later day)
  const rateHistory =
    sv &&
    input.rateBp !== undefined &&
    (rateFrom !== undefined || input.rateBp !== rateOnDay(ratesOf(d), todayLocal()))
      ? JSON.stringify(withRate(ratesOf(d), rateFrom ?? todayLocal(), input.rateBp))
      : undefined;
  const updated = await prisma.deposit.update({
    where: { id },
    data: {
      ...rest,
      ...(input.name !== undefined && {
        name: withKindSuffix(input.name, d.kind as 'fd' | 'rd' | 'savings'),
      }),
      ...(input.startDate && { startDate: parseDay(input.startDate)! }),
      maturityDate: maturity === null ? null : parseDay(maturity)!,
      ...(rateHistory !== undefined && { rateHistory }),
      ...((rd || sv) && { interest: 'reinvest' }),
      ...(principal !== undefined && { principal: BigInt(principal) }),
      ...(closedAt !== undefined && { closedAt: closedAt === null ? null : parseDay(closedAt)! }),
    },
    include: withRule,
  });
  if (rd) await syncRule(prisma, familyId, d, updated, book === null ? null : wanted);
  return withMoves(prisma, familyId, id);
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

/** Income and payments that can go with a deposit in `currency`: the family's, in that currency. */
async function checkLinks(
  prisma: PrismaClient,
  familyId: string,
  currency: string,
  transactionIds: string[],
  /** the deposit they go with (none yet while it is being added) */
  depositId: string | null = null,
) {
  if (transactionIds.length === 0) return;
  const rows = await prisma.transaction.findMany({
    where: { familyId, id: { in: transactionIds } },
    select: { type: true, currency: true, depositId: true },
  });
  if (rows.length !== new Set(transactionIds).size) throw notFound('Transaction');
  // never taken away from another deposit without a word (unlink it there first)
  if (rows.some((t) => t.depositId !== null && t.depositId !== depositId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A transaction is linked to another deposit');
  }
  if (rows.some((t) => t.type === 'transfer')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Transfers cannot be linked to a deposit');
  }
  if (rows.some((t) => t.currency !== currency)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Link only transactions in ${currency}`);
  }
}

export const LinkInput = z.object({ add: ids.default([]), remove: ids.default([]) });

/** Links and unlinks transactions from the deposit's own page, in one go. */
export async function linkTransactions(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof LinkInput>,
) {
  const d = await owned(prisma, familyId, id);
  if (d.closedAt && input.add.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'It is closed: reopen it to link transactions');
  }
  await checkLinks(prisma, familyId, d.currency, input.add, id);
  await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { familyId, depositId: id, id: { in: input.remove } },
      data: { depositId: null },
    }),
    prisma.transaction.updateMany({
      where: { familyId, id: { in: input.add }, OR: [{ depositId: null }, { depositId: id }] },
      data: { depositId: id },
    }),
  ]);
  return withMoves(prisma, familyId, id);
}

export const CandidateQuery = z.object({
  /** for a deposit that exists: matched against its account, amount, name and start */
  depositId: z.uuid().optional(),
  /** for one being added: its currency and account */
  currency: CurrencySchema.optional(),
  accountId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});

/**
 * Income and payments not linked to any deposit that may belong to one, the likely ones first:
 * in its currency, from a month before it started on (a new one: the last 400 days).
 */
export async function candidates(
  prisma: PrismaClient,
  familyId: string,
  q: z.output<typeof CandidateQuery>,
) {
  const d = q.depositId ? await owned(prisma, familyId, q.depositId) : null;
  const currency = d?.currency ?? q.currency;
  if (!currency) throw new AppError(400, 'VALIDATION_ERROR', 'Say which currency');
  const accountId = d ? d.accountId : (q.accountId ?? null);
  const from = d ? addDays(formatDay(d.startDate), -31) : addDays(todayLocal(), -400);
  const rules = await prisma.deposit.findMany({
    where: { familyId, recurringRuleId: { not: null } },
    select: { recurringRuleId: true },
  });
  const where: Prisma.TransactionWhereInput = {
    familyId,
    currency,
    depositId: null,
    // a new deposit is opened with a payment
    type: d ? { in: ['income', 'expense'] } : 'expense',
    date: { gte: parseDay(from)! },
    // instalments a recurring deposit books are its own already
    OR: [
      { recurringRuleId: null },
      { recurringRuleId: { notIn: rules.map((r) => r.recurringRuleId!) } },
    ],
    // a new deposit: only what its account paid, when it has one
    ...(!d && accountId && { accountId }),
    ...(q.q && {
      AND: [{ OR: [{ merchant: { contains: q.q } }, { notes: { contains: q.q } }] }],
    }),
  };
  const query = (extra: Prisma.TransactionWhereInput, take: number) =>
    prisma.transaction.findMany({
      where: { AND: [where, extra] },
      include: { account: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  // the latest ones, and those around its start (where its opening payment is), however old
  const [recent, nearStart] = await Promise.all([
    query({}, 400),
    d ? query({ date: { lte: parseDay(addDays(formatDay(d.startDate), 31))! } }, 200) : [],
  ]);
  const rows = [...new Map([...recent, ...nearStart].map((t) => [t.id, t])).values()];
  const target = {
    // matched without the kind added to it ("Trade Republic", not "Trade Republic Instant")
    name: d ? withoutKindSuffix(d.name, d.kind as 'fd' | 'rd' | 'savings') : '',
    accountId,
    amount: d ? Number(d.principal) : null,
    start: d ? formatDay(d.startDate) : '',
  };
  const items = rows
    .map((t) => {
      const text = [t.merchant, t.notes].filter(Boolean).join(' · ');
      const score = matchScore(target, {
        accountId: t.accountId,
        amount: Number(t.amount),
        date: formatDay(t.date),
        text,
      });
      return {
        id: t.id,
        date: formatDay(t.date),
        type: t.type as 'income' | 'expense',
        amount: Number(t.amount),
        accountId: t.accountId,
        accountName: t.account?.name ?? null,
        text: text || null,
        suggested: score >= 3,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 100);
  return { items };
}

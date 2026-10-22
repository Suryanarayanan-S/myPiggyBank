import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadRates } from './rateService.js';
import { CurrencySchema, convert, type Rate } from '../domain/currency.js';
import { ASSET_CLASSES, computeNetWorth } from '../domain/networth.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { listAccounts } from './accountService.js';
import { getFamily } from './familyService.js';
import { assertMember } from './ownership.js';
import { holdingValues } from './holdingService.js';
import { depositValues } from './depositService.js';
import { goldValues } from './goldService.js';

const LIABILITY_TYPES = ['mortgage', 'car_loan', 'personal_loan', 'credit_card', 'other'] as const;
const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const amount = z
  .number()
  .int('Amount must be in whole cents/paise')
  .min(0)
  .refine(Number.isSafeInteger);
const name = z.string().trim().min(1, 'Name is required').max(80);
const note = z.string().trim().max(200).nullable().optional();
const today = () => todayLocal();
// Values are stored in the item's currency; switching it would silently rescale the history.
const currencyLocked = () =>
  new AppError(400, 'CURRENCY_LOCKED', 'The currency cannot be changed once values are recorded');
const num = (v: bigint | null) => (v === null ? null : Number(v));

// ---------- assets ----------
export const AssetCreate = z.object({
  name,
  assetClass: z.enum(ASSET_CLASSES),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  value: amount.optional(),
  date: day.optional(),
});
export const AssetUpdate = AssetCreate.omit({ value: true, date: true }).partial();
export const ValuationInput = z.object({ date: day, value: amount, note });

const assetInclude = {
  valuations: { orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }] },
};
type AssetRow = Awaited<ReturnType<typeof loadAsset>>;
const loadAsset = (prisma: PrismaClient, id: string) =>
  prisma.asset.findUniqueOrThrow({ where: { id }, include: assetInclude });
const assetDto = (a: AssetRow) => ({
  id: a.id,
  name: a.name,
  assetClass: a.assetClass,
  currency: a.currency,
  ownerMemberId: a.ownerMemberId,
  notes: a.notes,
  value: num(a.valuations[0]?.value ?? null),
  valuedAt: a.valuations[0] ? formatDay(a.valuations[0].date) : null,
  history: a.valuations.map((v) => ({
    id: v.id,
    date: formatDay(v.date),
    value: Number(v.value),
    note: v.note,
  })),
});

async function ownedAsset(prisma: PrismaClient, familyId: string, id: string) {
  const a = await prisma.asset.findFirst({ where: { id, familyId } });
  if (!a) throw notFound('Asset');
  return a;
}
async function uniqueName(
  find: () => Promise<{ id: string; name: string }[]>,
  wanted: string,
  exceptId?: string,
) {
  if (
    (await find()).some((x) => x.id !== exceptId && x.name.toLowerCase() === wanted.toLowerCase())
  ) {
    throw new AppError(409, 'NAME_EXISTS', `"${wanted}" already exists`);
  }
}

export async function listAssets(prisma: PrismaClient, familyId: string) {
  const rows = await prisma.asset.findMany({
    where: { familyId },
    include: assetInclude,
    orderBy: { name: 'asc' },
  });
  return rows.map(assetDto);
}

export async function createAsset(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof AssetCreate>,
) {
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  await uniqueName(
    () => prisma.asset.findMany({ where: { familyId }, select: { id: true, name: true } }),
    input.name,
  );
  const { value, date, ...data } = input;
  const a = await prisma.asset.create({
    data: {
      ...data,
      familyId,
      ...(value !== undefined && {
        valuations: { create: { value, date: parseDay(date ?? today())! } },
      }),
    },
  });
  return assetDto(await loadAsset(prisma, a.id));
}

export async function updateAsset(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof AssetUpdate>,
) {
  const existing = await ownedAsset(prisma, familyId, id);
  if (input.currency && input.currency !== existing.currency) {
    if (await prisma.assetValuation.count({ where: { assetId: id } })) throw currencyLocked();
  }
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  if (input.name)
    await uniqueName(
      () => prisma.asset.findMany({ where: { familyId }, select: { id: true, name: true } }),
      input.name,
      id,
    );
  await prisma.asset.update({ where: { id }, data: input });
  return assetDto(await loadAsset(prisma, id));
}

export async function deleteAsset(prisma: PrismaClient, familyId: string, id: string) {
  await ownedAsset(prisma, familyId, id);
  await prisma.asset.delete({ where: { id } });
}

export async function addValuation(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof ValuationInput>,
) {
  await ownedAsset(prisma, familyId, id);
  await prisma.assetValuation.create({
    data: {
      assetId: id,
      date: parseDay(input.date)!,
      value: input.value,
      note: input.note ?? null,
    },
  });
  return assetDto(await loadAsset(prisma, id));
}

export async function deleteValuation(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  valuationId: string,
) {
  await ownedAsset(prisma, familyId, id);
  const { count } = await prisma.assetValuation.deleteMany({
    where: { id: valuationId, assetId: id },
  });
  if (!count) throw notFound('Valuation');
  return assetDto(await loadAsset(prisma, id));
}

// ---------- liabilities ----------
const rate = z
  .string()
  .trim()
  .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Enter the yearly interest rate, e.g. 3.75')
  .transform((s) => Math.round(Number(s.replace(',', '.')) * 100))
  .refine((bp) => bp <= 10_000, 'Interest rate must be at most 100 %');
export const LiabilityCreate = z.object({
  name,
  type: z.enum(LIABILITY_TYPES),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  originalAmount: amount.nullable().optional(),
  interestRate: rate.nullable().optional(),
  monthlyPayment: amount.nullable().optional(),
  startDate: day.nullable().optional(),
  endDate: day.nullable().optional(),
  lender: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  outstanding: amount.optional(),
  date: day.optional(),
});
export const LiabilityUpdate = LiabilityCreate.omit({ outstanding: true, date: true }).partial();
export const BalanceInput = z.object({ date: day, outstanding: amount });

const liabilityInclude = {
  balances: { orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }] },
};
const loadLiability = (prisma: PrismaClient, id: string) =>
  prisma.liability.findUniqueOrThrow({ where: { id }, include: liabilityInclude });
const fmtRate = (bp: number | null) => (bp === null ? null : String(bp / 100));
const liabilityDto = (l: Awaited<ReturnType<typeof loadLiability>>) => ({
  id: l.id,
  name: l.name,
  type: l.type,
  currency: l.currency,
  ownerMemberId: l.ownerMemberId,
  originalAmount: num(l.originalAmount),
  interestRate: fmtRate(l.interestRateBp),
  monthlyPayment: num(l.monthlyPayment),
  startDate: l.startDate ? formatDay(l.startDate) : null,
  endDate: l.endDate ? formatDay(l.endDate) : null,
  lender: l.lender,
  notes: l.notes,
  outstanding: num(l.balances[0]?.outstanding ?? null),
  balanceAt: l.balances[0] ? formatDay(l.balances[0].date) : null,
  history: l.balances.map((b) => ({
    id: b.id,
    date: formatDay(b.date),
    outstanding: Number(b.outstanding),
  })),
});
type LiabilityInput = Omit<z.output<typeof LiabilityUpdate>, 'interestRate'> & {
  interestRate?: number | null;
};
const liabilityData = ({ interestRate, startDate, endDate, ...rest }: LiabilityInput) => ({
  ...rest,
  ...(interestRate !== undefined && { interestRateBp: interestRate }),
  ...(startDate !== undefined && { startDate: startDate ? parseDay(startDate) : null }),
  ...(endDate !== undefined && { endDate: endDate ? parseDay(endDate) : null }),
});

async function ownedLiability(prisma: PrismaClient, familyId: string, id: string) {
  const l = await prisma.liability.findFirst({ where: { id, familyId } });
  if (!l) throw notFound('Liability');
  return l;
}

export async function listLiabilities(prisma: PrismaClient, familyId: string) {
  const rows = await prisma.liability.findMany({
    where: { familyId },
    include: liabilityInclude,
    orderBy: { name: 'asc' },
  });
  return rows.map(liabilityDto);
}

export async function createLiability(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof LiabilityCreate>,
) {
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  await uniqueName(
    () => prisma.liability.findMany({ where: { familyId }, select: { id: true, name: true } }),
    input.name,
  );
  const { outstanding, date, ...rest } = input;
  const l = await prisma.liability.create({
    data: {
      ...liabilityData(rest),
      name: rest.name,
      type: rest.type,
      currency: rest.currency,
      familyId,
      ...(outstanding !== undefined && {
        balances: { create: { outstanding, date: parseDay(date ?? today())! } },
      }),
    },
  });
  return liabilityDto(await loadLiability(prisma, l.id));
}

export async function updateLiability(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof LiabilityUpdate>,
) {
  const existing = await ownedLiability(prisma, familyId, id);
  if (input.currency && input.currency !== existing.currency) {
    if (await prisma.liabilityBalance.count({ where: { liabilityId: id } })) throw currencyLocked();
  }
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  if (input.name)
    await uniqueName(
      () => prisma.liability.findMany({ where: { familyId }, select: { id: true, name: true } }),
      input.name,
      id,
    );
  await prisma.liability.update({ where: { id }, data: liabilityData(input) });
  return liabilityDto(await loadLiability(prisma, id));
}

export async function deleteLiability(prisma: PrismaClient, familyId: string, id: string) {
  await ownedLiability(prisma, familyId, id);
  await prisma.liability.delete({ where: { id } });
}

export async function addBalance(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof BalanceInput>,
) {
  await ownedLiability(prisma, familyId, id);
  await prisma.liabilityBalance.create({
    data: { liabilityId: id, date: parseDay(input.date)!, outstanding: input.outstanding },
  });
  return liabilityDto(await loadLiability(prisma, id));
}

export async function deleteBalance(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  balanceId: string,
) {
  await ownedLiability(prisma, familyId, id);
  const { count } = await prisma.liabilityBalance.deleteMany({
    where: { id: balanceId, liabilityId: id },
  });
  if (!count) throw notFound('Balance');
  return liabilityDto(await loadLiability(prisma, id));
}

// ---------- net worth + snapshots ----------
async function currentNetWorth(
  prisma: PrismaClient,
  familyId: string,
  view?: string,
  loaded?: Rate[],
) {
  const [family, rates, members, accounts, assets, liabilities, holdings, deposits, gold] =
    await Promise.all([
      getFamily(prisma, familyId),
      loaded ?? loadRates(prisma, familyId),
      prisma.familyMember.findMany({
        where: { familyId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      }),
      listAccounts(prisma, familyId),
      listAssets(prisma, familyId),
      listLiabilities(prisma, familyId),
      holdingValues(prisma, familyId),
      depositValues(prisma, familyId),
      goldValues(prisma, familyId),
    ]);
  return computeNetWorth({
    currency: view ?? family.wealthCurrency,
    month: today().slice(0, 7),
    rates,
    members,
    accounts,
    // Holdings, deposits and gold count like assets of the investment class.
    assets: [...assets, ...holdings, ...deposits, ...gold],
    liabilities,
  });
}

type SnapshotRow = Awaited<ReturnType<PrismaClient['netWorthSnapshot']['findFirstOrThrow']>>;
const snapshotDto = (s: SnapshotRow) => ({
  id: s.id,
  date: formatDay(s.date),
  currency: s.currency,
  assets: num(s.assets),
  liabilities: num(s.liabilities),
  netWorth: Number(s.netWorth),
  note: s.note,
  manual: s.breakdown === null,
});

/** Net worth in `view` (default: the wealth currency). Snapshots are converted with the rate of
 *  their month; one that cannot be converted keeps its own currency. */
export async function getNetWorth(prisma: PrismaClient, familyId: string, view?: string) {
  const rates = await loadRates(prisma, familyId);
  const [current, rows] = await Promise.all([
    currentNetWorth(prisma, familyId, view, rates),
    prisma.netWorthSnapshot.findMany({
      where: { familyId },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const to = current.currency;
  const snapshots = rows.map(snapshotDto).map((s) => {
    if (s.currency === to) return s;
    const month = s.date.slice(0, 7);
    const conv = (v: number | null) =>
      v === null ? null : convert(v, s.currency, to, month, rates);
    const netWorth = conv(s.netWorth);
    if (netWorth === null) return s;
    return {
      ...s,
      currency: to,
      netWorth,
      assets: conv(s.assets),
      liabilities: conv(s.liabilities),
    };
  });
  const latestBefore = (days: number) => {
    const cutoff = addDays(today(), -days);
    // The nearest one counts; if it cannot be shown in this currency there is no comparison
    // (rather than quietly comparing with an older one).
    const nearest = [...snapshots].reverse().find((s) => s.date <= cutoff);
    return nearest?.currency === to ? nearest : null;
  };
  return { current, snapshots, previousMonth: latestBefore(28), previousYear: latestBefore(365) };
}

// Strict objects: a malformed past entry must be rejected, never treated as "snapshot today".
export const SnapshotInput = z.union([
  z.strictObject({ date: day, netWorth: z.number().int().refine(Number.isSafeInteger), note }),
  z.strictObject({ note }),
]);
export const SnapshotUpdate = z.object({ note });

export async function createSnapshot(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof SnapshotInput>,
) {
  const family = await getFamily(prisma, familyId);
  if ('netWorth' in input) {
    const s = await prisma.netWorthSnapshot.create({
      data: {
        familyId,
        date: parseDay(input.date)!,
        currency: family.wealthCurrency,
        netWorth: input.netWorth,
        note: input.note ?? null,
      },
    });
    return snapshotDto(s);
  }
  const nw = await currentNetWorth(prisma, familyId);
  if (nw.unconverted.length > 0) {
    throw new AppError(
      409,
      'UNCONVERTED_AMOUNTS',
      `Add an exchange rate first: ${nw.unconverted.map((u) => u.currency).join(', ')} amounts cannot be converted to ${nw.currency} and the snapshot would be too low`,
    );
  }
  const s = await prisma.netWorthSnapshot.create({
    data: {
      familyId,
      date: parseDay(today())!,
      currency: nw.currency,
      assets: nw.assets,
      liabilities: nw.liabilities,
      netWorth: nw.netWorth,
      breakdown: JSON.stringify({ byClass: nw.byClass, columns: nw.columns }),
      note: input.note ?? null,
    },
  });
  return snapshotDto(s);
}

async function ownedSnapshot(prisma: PrismaClient, familyId: string, id: string) {
  const s = await prisma.netWorthSnapshot.findFirst({ where: { id, familyId } });
  if (!s) throw notFound('Snapshot');
}

export async function updateSnapshot(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof SnapshotUpdate>,
) {
  await ownedSnapshot(prisma, familyId, id);
  return snapshotDto(
    await prisma.netWorthSnapshot.update({ where: { id }, data: { note: input.note ?? null } }),
  );
}

export async function deleteSnapshot(prisma: PrismaClient, familyId: string, id: string) {
  await ownedSnapshot(prisma, familyId, id);
  await prisma.netWorthSnapshot.delete({ where: { id } });
}

import type { Holding, HoldingPrice, HoldingTrade, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, convert, formatRate, parseRate } from '../domain/currency.js';
import { computeHolding, oversold, type Trade } from '../domain/holdings.js';
import { formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { assertAccount, assertMember } from './ownership.js';
import { loadRates } from './rateService.js';

export const HOLDING_KINDS = ['stock', 'etf', 'fund', 'gold', 'other'] as const;
const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
const pastDay = day.refine((d) => d <= todayLocal(), 'The date cannot be in the future');
const cents = z.number().int('Use whole cents').refine(Number.isSafeInteger, 'Amount is too large');
/** "12.5" or "12,5" with up to 6 decimals → micros (units or price per unit). */
const micros = (label: string) =>
  z
    .string()
    .refine((s) => parseRate(s) !== null, `Enter the ${label} as a number above zero, e.g. 12.5`);

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(60),
  kind: z.enum(HOLDING_KINDS),
  symbol: z.string().trim().max(20).nullable().optional(),
  currency: CurrencySchema,
  ownerMemberId: z.uuid().nullable().optional(),
  accountId: z.uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  archived: z.boolean().optional(),
};
export const HoldingCreate = z.object(fields);
export const HoldingUpdate = z.object(fields).partial();
export const TradeInput = z
  .object({
    date: pastDay,
    type: z.enum(['buy', 'sell', 'dividend']),
    units: micros('number of units').optional(),
    amount: cents.positive('Enter an amount above zero'),
    fees: cents.min(0).optional(),
  })
  .refine((t) => t.type === 'dividend' || t.units !== undefined, {
    message: 'Enter the number of units',
    path: ['units'],
  });
export const PriceInput = z.object({ date: pastDay, price: micros('price') });

type Row = Holding & { trades: HoldingTrade[]; prices: HoldingPrice[] };
const asTrades = (rows: HoldingTrade[]): Trade[] =>
  rows.map((t) => ({
    date: formatDay(t.date),
    type: t.type as Trade['type'],
    units: Number(t.units),
    amount: Number(t.amount),
    fees: Number(t.fees),
  }));
const asPrices = (rows: HoldingPrice[]) =>
  rows.map((p) => ({ date: formatDay(p.date), price: Number(p.price) }));

/** A holding with what it is worth on `onDay` (default today). */
function computed(h: Row, onDay = todayLocal()) {
  const c = computeHolding(asTrades(h.trades), asPrices(h.prices), onDay);
  const str = (n: number | null) => (n === null ? null : formatRate(n));
  return {
    id: h.id,
    name: h.name,
    kind: h.kind,
    symbol: h.symbol,
    currency: h.currency,
    ownerMemberId: h.ownerMemberId,
    accountId: h.accountId,
    note: h.note,
    archived: h.archived,
    units: formatRate(c.units),
    avgCost: str(c.avgCost),
    price: str(c.price),
    priceDate: c.priceDate,
    priceSource: c.priceSource,
    cost: c.cost,
    value: c.value,
    unrealised: c.unrealised,
    returnBp: c.returnBp,
    realised: c.realised,
    dividends: c.dividends,
    trades: [...h.trades]
      .sort(
        (a, b) =>
          b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .map((t) => ({
        id: t.id,
        date: formatDay(t.date),
        type: t.type,
        units: t.type === 'dividend' ? null : formatRate(Number(t.units)),
        amount: Number(t.amount),
        fees: Number(t.fees),
      })),
    prices: [...h.prices]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((p) => ({ id: p.id, date: formatDay(p.date), price: formatRate(Number(p.price)) })),
  };
}

const include = {
  trades: { orderBy: [{ date: 'asc' as const }, { createdAt: 'asc' as const }] },
  prices: true,
};
const load = (prisma: PrismaClient, familyId: string) =>
  prisma.holding.findMany({
    where: { familyId },
    include,
    orderBy: [{ archived: 'asc' }, { name: 'asc' }],
  });

async function owned(prisma: PrismaClient, familyId: string, id: string) {
  const h = await prisma.holding.findFirst({ where: { id, familyId }, include });
  if (!h) throw notFound('Holding');
  return h;
}

async function checkRefs(
  prisma: PrismaClient,
  familyId: string,
  input: { ownerMemberId?: string | null; accountId?: string | null },
) {
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  if (input.accountId) await assertAccount(prisma, familyId, input.accountId);
}

/** Holdings with their numbers, plus the totals in one currency (default: wealth currency). */
export async function listHoldings(prisma: PrismaClient, familyId: string, view?: string) {
  const [rows, family, rates, members] = await Promise.all([
    load(prisma, familyId),
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    prisma.familyMember.findMany({ where: { familyId }, select: { id: true, name: true } }),
  ]);
  const holdings = rows.map((h) => computed(h));
  const currency = view ?? family.wealthCurrency;
  const month = todayLocal().slice(0, 7);
  const sum = { value: 0, invested: 0, unrealised: 0, realised: 0, dividends: 0 };
  const byKind = new Map<string, number>();
  const byMember = new Map<string | null, number>();
  const unconverted = new Map<string, number>();
  for (const h of holdings.filter((x) => !x.archived)) {
    const to = (n: number) => convert(n, h.currency, currency, month, rates);
    const value = h.value === null ? 0 : to(h.value);
    if (value === null) {
      unconverted.set(h.currency, (unconverted.get(h.currency) ?? 0) + (h.value ?? 0));
      continue;
    }
    sum.value += value;
    sum.invested += to(h.cost)!;
    sum.unrealised += to(h.unrealised ?? 0)!;
    sum.realised += to(h.realised)!;
    sum.dividends += to(h.dividends)!;
    if (value !== 0) {
      byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + value);
      const owner = members.some((m) => m.id === h.ownerMemberId) ? h.ownerMemberId : null;
      byMember.set(owner, (byMember.get(owner) ?? 0) + value);
    }
  }
  return {
    holdings,
    summary: {
      currency,
      ...sum,
      byKind: [...byKind]
        .map(([kind, value]) => ({ kind, value }))
        .sort((a, b) => b.value - a.value),
      byMember: [...byMember]
        .map(([memberId, value]) => ({
          memberId,
          name: members.find((m) => m.id === memberId)?.name ?? 'Shared',
          value,
        }))
        .sort((a, b) => b.value - a.value),
      unconverted: [...unconverted].map(([c, amount]) => ({ currency: c, amount })),
    },
  };
}

/** Open holdings as net-worth items (investment class) and for goals, valued on a day. */
export async function holdingValues(prisma: PrismaClient, familyId: string, onDay = todayLocal()) {
  const rows = await prisma.holding.findMany({ where: { familyId, archived: false }, include });
  return rows.map((h) => {
    const c = computed(h, onDay);
    return {
      id: h.id,
      name: h.name,
      currency: h.currency,
      ownerMemberId: h.ownerMemberId,
      assetClass: 'investment',
      value: c.value,
    };
  });
}

export async function createHolding(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof HoldingCreate>,
) {
  await checkRefs(prisma, familyId, input);
  const h = await prisma.holding.create({ data: { ...input, familyId }, include });
  return computed(h);
}

export async function updateHolding(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof HoldingUpdate>,
) {
  const existing = await owned(prisma, familyId, id);
  await checkRefs(prisma, familyId, input);
  if (input.currency && input.currency !== existing.currency && existing.trades.length > 0) {
    throw new AppError(
      409,
      'CURRENCY_LOCKED',
      'The currency cannot be changed once there are trades',
    );
  }
  return computed(await prisma.holding.update({ where: { id }, data: input, include }));
}

export async function deleteHolding(prisma: PrismaClient, familyId: string, id: string) {
  await owned(prisma, familyId, id);
  await prisma.holding.delete({ where: { id } });
}

const notEnough = () =>
  new AppError(409, 'NOT_ENOUGH_UNITS', 'That would sell more units than are held at that date');

export async function addTrade(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof TradeInput>,
) {
  const h = await owned(prisma, familyId, id);
  const units = input.type === 'dividend' ? 0 : parseRate(input.units!)!;
  const next: Trade = {
    date: input.date,
    type: input.type,
    units,
    amount: input.amount,
    fees: input.fees ?? 0,
  };
  if (oversold([...asTrades(h.trades), next])) throw notEnough();
  await prisma.holdingTrade.create({
    data: {
      holdingId: id,
      date: parseDay(input.date)!,
      type: input.type,
      units,
      amount: input.amount,
      fees: input.fees ?? 0,
    },
  });
  return computed(await owned(prisma, familyId, id));
}

export async function deleteTrade(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  tradeId: string,
) {
  const h = await owned(prisma, familyId, id);
  if (!h.trades.some((t) => t.id === tradeId)) throw notFound('Trade');
  if (oversold(asTrades(h.trades.filter((t) => t.id !== tradeId)))) throw notEnough();
  await prisma.holdingTrade.delete({ where: { id: tradeId } });
  return computed(await owned(prisma, familyId, id));
}

export async function setPrice(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof PriceInput>,
) {
  await owned(prisma, familyId, id);
  const date = parseDay(input.date)!;
  const price = parseRate(input.price)!;
  await prisma.holdingPrice.upsert({
    where: { holdingId_date: { holdingId: id, date } },
    create: { holdingId: id, date, price },
    update: { price },
  });
  return computed(await owned(prisma, familyId, id));
}

export async function deletePrice(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  priceId: string,
) {
  await owned(prisma, familyId, id);
  const { count } = await prisma.holdingPrice.deleteMany({ where: { id: priceId, holdingId: id } });
  if (!count) throw notFound('Price');
  return computed(await owned(prisma, familyId, id));
}

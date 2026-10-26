import type {
  Holding,
  HoldingAction,
  HoldingPrice,
  HoldingTrade,
  PrismaClient,
} from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, convert, formatRate, parseRate } from '../domain/currency.js';
import { computeHolding, oversold, type Trade } from '../domain/holdings.js';
import { formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { getFamily } from './familyService.js';
import { assertAccount, assertMember } from './ownership.js';
import { plainSymbol } from '../domain/brokerHoldings.js';
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
    type: z.enum(['buy', 'sell', 'dividend', 'interest']),
    // checked below: dividends have no units (ignored if sent) and no fees
    units: z.string().max(30).optional(),
    amount: cents.positive('Enter an amount above zero'),
    fees: cents.min(0).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.type === 'dividend' || t.type === 'interest') {
      if (t.fees)
        ctx.addIssue({ code: 'custom', path: ['fees'], message: `Enter the ${t.type} after fees` });
    } else if (t.units === undefined || parseRate(t.units) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['units'],
        message: 'Enter the number of units as a number above zero, e.g. 12.5',
      });
    }
  });
export const PriceInput = z.object({ date: pastDay, price: micros('price') });

type Row = Holding & {
  trades: HoldingTrade[];
  prices: HoldingPrice[];
  actions?: HoldingAction[];
};
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
    realisedBp: c.realisedBp,
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
        units: t.type === 'dividend' || t.type === 'interest' ? null : formatRate(Number(t.units)),
        amount: Number(t.amount),
        fees: Number(t.fees),
      })),
    prices: [...h.prices]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((p) => ({ id: p.id, date: formatDay(p.date), price: formatRate(Number(p.price)) })),
    /** splits, bonus issues and the like: applied, or for the user to check; newest first */
    actions: [...(h.actions ?? [])]
      .sort((a, b) => b.exDate.getTime() - a.exDate.getTime())
      .map((a) => ({
        exDate: formatDay(a.exDate),
        purpose: a.purpose,
        kind: a.kind,
        status: a.status,
        unitsBefore: formatRate(Number(a.unitsBefore)),
        unitsAfter: formatRate(Number(a.unitsAfter)),
      })),
  };
}

const include = {
  trades: { orderBy: [{ date: 'asc' as const }, { createdAt: 'asc' as const }] },
  prices: true,
  actions: true,
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
  return input.accountId ? assertAccount(prisma, familyId, input.accountId) : null;
}

/** A holding in a demat (an open account of the type Investment) is the demat owner's. */
const demat = (a: { type: string; archived: boolean; ownerMemberId: string | null } | null) =>
  a && a.type === 'investment' && !a.archived ? { ownerMemberId: a.ownerMemberId } : {};

/** Holdings with their numbers, plus the totals in one currency (default: wealth currency). */
export async function listHoldings(prisma: PrismaClient, familyId: string, view?: string) {
  const [rows, family, rates, members] = await Promise.all([
    load(prisma, familyId),
    getFamily(prisma, familyId),
    loadRates(prisma, familyId),
    prisma.familyMember.findMany({ where: { familyId }, select: { id: true, name: true } }),
  ]);
  // Industry and size group of rupee holdings listed on NSE (when downloaded).
  const keyOf = (h: { currency: string; symbol: string | null }) =>
    h.currency === 'INR' && h.symbol ? plainSymbol(h.symbol) : null;
  const keys = [...new Set(rows.map(keyOf).filter((k): k is string => k !== null))];
  const infos = new Map(
    (keys.length
      ? await prisma.instrumentInfo.findMany({ where: { symbol: { in: keys } } })
      : []
    ).map((i) => [i.symbol, i]),
  );
  const holdings = rows.map((h) => {
    const info = infos.get(keyOf(h) ?? '');
    return {
      ...computed(h),
      industry: info?.industry ?? null,
      cap: (info?.cap ?? null) as 'large' | 'mid' | 'small' | null,
    };
  });
  const currency = view ?? family.wealthCurrency;
  const month = todayLocal().slice(0, 7);
  const sum = { value: 0, invested: 0, realised: 0, dividends: 0 };
  const byKind = new Map<string, number>();
  const byMember = new Map<string | null, number>();
  const unconverted = new Map<string, number>();
  // Income and sales of archived holdings (sold long ago) count too: the money came in all the
  // same. Only their value is left out.
  for (const h of holdings.filter((x) => x.archived)) {
    for (const [part, n] of [
      ['dividends', h.dividends],
      ['realised', h.realised],
    ] as const) {
      if (n === 0) continue;
      const v = convert(n, h.currency, currency, month, rates);
      if (v === null) unconverted.set(h.currency, (unconverted.get(h.currency) ?? 0) + n);
      else sum[part] += v;
    }
  }
  for (const h of holdings.filter((x) => !x.archived)) {
    // Each part on its own: zero needs no rate, and a part without a rate is listed, not lost.
    const part = (n: number) => {
      if (n === 0) return 0;
      const v = convert(n, h.currency, currency, month, rates);
      if (v === null) unconverted.set(h.currency, (unconverted.get(h.currency) ?? 0) + n);
      return v;
    };
    const value = part(h.value ?? 0);
    if (value !== null) {
      sum.value += value;
      sum.invested += part(h.cost) ?? 0; // same rate as the value, so it converts too
    }
    sum.realised += part(h.realised) ?? 0;
    sum.dividends += part(h.dividends) ?? 0;
    if (value === null) continue;
    if (value !== 0) {
      byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + value);
      const owner = members.some((m) => m.id === h.ownerMemberId) ? h.ownerMemberId : null;
      byMember.set(owner, (byMember.get(owner) ?? 0) + value);
    }
  }
  // Each holding's value and cost in the summary currency (null without a rate), for weights.
  const inView = (h: (typeof holdings)[number]) => {
    if (h.value === null) return null;
    const value = h.value === 0 ? 0 : convert(h.value, h.currency, currency, month, rates);
    const cost = h.cost === 0 ? 0 : convert(h.cost, h.currency, currency, month, rates);
    return value === null || cost === null ? null : { value, cost };
  };
  return {
    holdings: holdings.map((h) => ({ ...h, inView: inView(h) })),
    summary: {
      currency,
      ...sum,
      // derived, so value − invested always matches it to the cent
      unrealised: sum.value - sum.invested,
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
export async function holdingValues(
  prisma: PrismaClient,
  familyId: string,
  onDay = todayLocal(),
  opts: { includeArchived?: boolean } = {},
) {
  const [rows, family] = await Promise.all([
    prisma.holding.findMany({
      where: { familyId, ...(!opts.includeArchived && { archived: false }) },
      include,
    }),
    getFamily(prisma, familyId),
  ]);
  // The family chooses whether holdings count at today's price or at what was paid for them.
  const atCost = family.investmentsAt === 'invested';
  return rows.map((h) => {
    const c = computed(h, onDay);
    return {
      id: h.id,
      name: h.name,
      currency: h.currency,
      ownerMemberId: h.ownerMemberId,
      assetClass: 'investment',
      // Nothing held: nothing to count (and no exchange rate needed for it).
      value: c.units === '0' ? null : atCost ? c.cost : c.value,
    };
  });
}

export async function createHolding(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof HoldingCreate>,
) {
  const account = await checkRefs(prisma, familyId, input);
  const h = await prisma.holding.create({
    data: { ...input, ...demat(account), familyId },
    include,
  });
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
  const accountId = input.accountId !== undefined ? input.accountId : existing.accountId;
  const account = accountId ? await prisma.account.findUnique({ where: { id: accountId } }) : null;
  if (input.currency && input.currency !== existing.currency && existing.trades.length > 0) {
    throw new AppError(
      409,
      'CURRENCY_LOCKED',
      'The currency cannot be changed once there are trades',
    );
  }
  return computed(
    await prisma.holding.update({ where: { id }, data: { ...input, ...demat(account) }, include }),
  );
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
  const units =
    input.type === 'dividend' || input.type === 'interest' ? 0 : parseRate(input.units!)!;
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
  const trade = h.trades.find((t) => t.id === tradeId);
  if (!trade) throw notFound('Trade');
  if (oversold(asTrades(h.trades.filter((t) => t.id !== tradeId)))) throw notEnough();
  await prisma.$transaction([
    prisma.holdingTrade.delete({ where: { id: tradeId } }),
    // a payout taken out stays out: the daily dividend check does not add it again
    ...(trade.type === 'dividend' || trade.type === 'interest'
      ? [
          prisma.removedPayout.upsert({
            where: {
              holdingId_date_kind: { holdingId: id, date: trade.date, kind: trade.type },
            },
            create: { holdingId: id, date: trade.date, kind: trade.type },
            update: {},
          }),
        ]
      : []),
  ]);
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
    create: { holdingId: id, date, price, source: 'manual' },
    // Typed by hand: NSE downloads never replace it, even where one was downloaded before.
    update: { price, source: 'manual' },
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

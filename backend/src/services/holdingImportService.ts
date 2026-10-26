import type { PrismaClient } from '@prisma/client';
import type { Db } from '../lib/db.js';
import { z } from 'zod';
import {
  kindOf,
  plainSymbol,
  readBrokerHoldings,
  type BrokerHolding,
  type BrokerRowError,
} from '../domain/brokerHoldings.js';
import { decodeText, parseCsv } from '../domain/csv.js';
import { formatRate } from '../domain/currency.js';
import { computeHolding, valueOf, type Trade } from '../domain/holdings.js';
import { formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { AppError, notFound } from '../lib/errors.js';
import { assertAccount, assertMember } from './ownership.js';
import { awaitingCredit } from './corporateActionService.js';

/** Zerodha (Kite) holdings are Indian instruments, priced in rupees. */
const CURRENCY = 'INR';
const MAX_ROWS = 500;
/** base64 of a holdings file; the route allows a body a little larger than this. */
export const MAX_FILE_CHARS = 2_000_000;

export const HoldingImportInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(MAX_FILE_CHARS),
  /** Whose demat the file comes from (null: shared). */
  ownerMemberId: z.uuid().nullable(),
  /** The demat account it comes from: its owner decides whose the holdings are. */
  accountId: z.uuid().nullable().optional(),
  /** A manual asset these holdings replace: it gets a value of 0 today (history kept). */
  retireAssetId: z.uuid().nullable().optional(),
  /** Holdings of this person that are not in the file are sold at their last price today. */
  sellMissing: z.boolean().optional(),
});
type Input = z.output<typeof HoldingImportInput>;

function readFile(input: Input): { rows: BrokerHolding[]; errors: BrokerRowError[] } {
  const { rows } = parseCsv(decodeText(Buffer.from(input.data, 'base64')));
  if (rows.length - 1 > MAX_ROWS) {
    throw new AppError(400, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} holdings per file`);
  }
  try {
    return readBrokerHoldings(rows);
  } catch (e) {
    throw new AppError(400, 'INVALID_HOLDINGS_FILE', (e as Error).message);
  }
}

/** Every rupee holding with a symbol, with its units, cost and value today. */
async function rupeeHoldings(db: Db, familyId: string) {
  const today = todayLocal();
  const rows = await db.holding.findMany({
    where: { familyId, currency: CURRENCY, symbol: { not: null } },
    include: {
      trades: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
      prices: true,
      owner: { select: { name: true } },
      account: { select: { type: true, archived: true } },
      actions: { where: { status: 'applied' } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((h) => {
    const trades: Trade[] = h.trades.map((t) => ({
      date: formatDay(t.date),
      type: t.type as Trade['type'],
      units: Number(t.units),
      amount: Number(t.amount),
      fees: Number(t.fees),
    }));
    const prices = h.prices.map((p) => ({ date: formatDay(p.date), price: Number(p.price) }));
    const c = computeHolding(trades, prices, today);
    return {
      holding: h,
      key: plainSymbol(h.symbol!),
      units: c.units,
      /** a file showing these units only awaits a split's or bonus's new shares (not a sale) */
      awaiting: (fileUnits: number) => awaitingCredit(h.actions, fileUnits, today),
      cost: c.cost,
      value: c.value,
    };
  });
}
type Existing = Awaited<ReturnType<typeof rupeeHoldings>>[number];

/** Whose holdings an import is for: a demat account's (its owner's), or a person's. */
export type Demat = { owner: string | null; accountId: string | null };

export async function dematOf(
  db: Db,
  familyId: string,
  input: { ownerMemberId: string | null; accountId?: string | null },
): Promise<Demat> {
  if (input.accountId) {
    const a = await assertAccount(db, familyId, input.accountId);
    if (a.type !== 'investment') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Choose a demat account (an account of the type Investment)',
      );
    }
    return { owner: a.ownerMemberId, accountId: a.id };
  }
  if (input.ownerMemberId) await assertMember(db, familyId, input.ownerMemberId);
  return { owner: input.ownerMemberId, accountId: null };
}

type Placed = {
  ownerMemberId: string | null;
  accountId: string | null;
  account: { type: string; archived: boolean } | null;
};
/** In no open demat: no account, one that is not a demat, or a closed (archived) demat. */
const loose = (h: Placed) => !h.account || h.account.type !== 'investment' || h.account.archived;

/**
 * A holding the import may update: one in this demat (whoever it was entered for: the demat
 * decides), or one of the person's in no open demat (it is moved into it). Without a demat,
 * only the person's in none — never another demat's.
 */
export const inDemat = (d: Demat) => (h: Placed) =>
  (d.accountId !== null && h.accountId === d.accountId) ||
  (loose(h) && h.ownerMemberId === d.owner);

export const MoveToDematInput = z.object({ accountId: z.uuid() });

/** The demat owner's rupee holdings in no open demat moved into it. */
export async function moveToDemat(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof MoveToDematInput>,
) {
  const d = await dematOf(prisma, familyId, { ownerMemberId: null, accountId: input.accountId });
  const { count } = await prisma.holding.updateMany({
    where: {
      familyId,
      ownerMemberId: d.owner,
      currency: CURRENCY,
      OR: [
        { accountId: null },
        { account: { type: { not: 'investment' } } },
        { account: { archived: true } },
      ],
    },
    data: { accountId: d.accountId },
  });
  return { moved: count };
}

/**
 * The demat's holdings by symbol. With two of the same symbol, the open one with the most
 * units is the one kept up to date (deterministic, never both).
 */
function byOwner(all: Existing[], d: Demat) {
  const map = new Map<string, Existing>();
  for (const e of all.filter((x) => inDemat(d)(x.holding))) {
    const had = map.get(e.key);
    const better =
      !had ||
      (had.holding.archived && !e.holding.archived) ||
      (had.holding.archived === e.holding.archived && e.units > had.units);
    if (better) map.set(e.key, e);
  }
  return map;
}

/** The manual asset to retire must be this family's, an investment, in rupees. */
async function retireTarget(db: Db, familyId: string, id: string) {
  const asset = await db.asset.findFirst({ where: { id, familyId } });
  if (!asset) throw notFound('Asset');
  if (asset.assetClass !== 'investment' || asset.currency !== CURRENCY) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Only an investment asset in rupees can be replaced by imported holdings',
    );
  }
  return asset;
}

export async function previewHoldingImport(prisma: PrismaClient, familyId: string, input: Input) {
  const d = await dematOf(prisma, familyId, input);
  const { rows, errors } = readFile(input);
  const all = await rupeeHoldings(prisma, familyId);
  const mine = byOwner(all, d);
  const inFile = new Set(rows.map((r) => r.symbol));
  const out = rows.map((r) => {
    const had = mine.get(r.symbol);
    const status = !had
      ? ('new' as const)
      : had.awaiting(r.units)
        ? ('same' as const)
        : r.units > had.units
          ? ('more' as const)
          : r.units < had.units
            ? ('less' as const)
            : ('same' as const);
    // The same instrument held by someone else (another demat) — worth a second look.
    const alsoHeldBy = [
      ...new Set(
        all
          .filter(
            (e) =>
              e.key === r.symbol && !inDemat(d)(e.holding) && e.units > 0 && !e.holding.archived,
          )
          .map((e) => e.holding.owner?.name ?? 'Shared'),
      ),
    ];
    return {
      symbol: r.symbol,
      kind: had?.holding.kind ?? kindOf(r.symbol),
      status,
      unitsBefore: had ? formatRate(had.units) : null,
      units: formatRate(r.units),
      price: formatRate(r.price),
      invested: r.invested,
      value: valueOf(r.units, r.price),
      alsoHeldBy,
    };
  });

  // Manual assets that may hold the same money, so it is not counted twice.
  const owner = d.owner ? await prisma.familyMember.findUnique({ where: { id: d.owner } }) : null;
  const [assets, links] = await Promise.all([
    prisma.asset.findMany({
      where: { familyId, assetClass: 'investment', currency: CURRENCY },
      include: { valuations: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 1 } },
      orderBy: { name: 'asc' },
    }),
    prisma.goalLink.findMany({
      where: { kind: 'asset', goal: { familyId } },
      select: { refId: true, goal: { select: { name: true } } },
    }),
  ]);
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);
  const looksLike = (name: string) => {
    const n = words(name);
    const broker = n.some((w) => /^(zerod|zerot|kite|demat)/.test(w));
    // "Zerotha Surya" for a member "Surya" or "Suryanarayanan": a shared first part is enough.
    const person =
      !owner ||
      n.some((w) =>
        words(owner.name).some((o) => w.length > 2 && (o.startsWith(w) || w.startsWith(o))),
      );
    return broker && person;
  };

  return {
    currency: CURRENCY,
    rows: out,
    errors,
    totals: {
      invested: out.reduce((s, r) => s + r.invested, 0),
      value: out.reduce((s, r) => s + r.value, 0),
    },
    /** This person's open holdings not in the file (sold, or in another depot). */
    missing: [...mine.values()]
      .filter((e) => e.units > 0 && !inFile.has(e.key))
      .map((e) => ({
        symbol: e.holding.symbol!,
        name: e.holding.name,
        units: formatRate(e.units),
        value: e.value,
      })),
    assets: assets
      .map((a) => ({ id: a.id, name: a.name, value: Number(a.valuations[0]?.value ?? 0) }))
      .filter((a) => a.value > 0)
      .map((a) => ({
        ...a,
        suggested: looksLike(a.name),
        goals: links.filter((l) => l.refId === a.id).map((l) => l.goal.name),
      })),
  };
}

export async function commitHoldingImport(prisma: PrismaClient, familyId: string, input: Input) {
  const { rows } = readFile(input);
  if (rows.length === 0) {
    throw new AppError(
      400,
      'INVALID_HOLDINGS_FILE',
      'There are no holdings in this file to import',
    );
  }
  const date = todayLocal();
  const today = parseDay(date)!;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let sold = 0;
  // Read and write in one transaction, so two imports at once cannot both create a holding.
  await prisma.$transaction(
    async (tx) => {
      const d = await dematOf(tx, familyId, input);
      if (input.retireAssetId) await retireTarget(tx, familyId, input.retireAssetId);
      const mine = byOwner(await rupeeHoldings(tx, familyId), d);
      for (const r of rows) {
        const had = mine.get(r.symbol);
        const price = { date: today, price: r.price, source: 'import' };
        if (!had) {
          await tx.holding.create({
            data: {
              familyId,
              name: r.symbol,
              symbol: r.symbol,
              kind: kindOf(r.symbol),
              currency: CURRENCY,
              ownerMemberId: d.owner,
              accountId: d.accountId,
              note: `Imported from a Zerodha holdings file on ${date}`,
              trades: {
                create: { date: today, type: 'buy', units: r.units, amount: r.invested },
              },
              prices: { create: price },
            },
          });
          created++;
          continue;
        }
        const id = had.holding.id;
        // Just after a split the broker may still show the old count: nothing was sold.
        const diff = had.awaiting(r.units) ? 0 : r.units - had.units;
        if (diff > 0) {
          // Bought more: what the broker now shows as invested, beyond what was recorded.
          await tx.holdingTrade.create({
            data: {
              holdingId: id,
              date: today,
              type: 'buy',
              units: diff,
              amount: Math.max(0, r.invested - had.cost),
            },
          });
        } else if (diff < 0) {
          // Sold some: at today's price (the file does not say what was received).
          await tx.holdingTrade.create({
            data: {
              holdingId: id,
              date: today,
              type: 'sell',
              units: -diff,
              amount: valueOf(-diff, r.price),
            },
          });
        }
        const before = had.holding.prices.find((p) => +p.date === +today);
        await tx.holdingPrice.upsert({
          where: { holdingId_date: { holdingId: id, date: today } },
          create: { holdingId: id, ...price },
          update: { price: r.price, source: 'import' },
        });
        const moved =
          d.accountId !== null &&
          (had.holding.accountId !== d.accountId || had.holding.ownerMemberId !== d.owner);
        if (had.holding.archived || moved) {
          await tx.holding.update({
            where: { id },
            data: {
              ...(moved && { accountId: d.accountId, ownerMemberId: d.owner }),
              ...(had.holding.archived && {
                archived: false,
                // held again: the dividend import's "no longer held" note is out of date
                ...(had.holding.note?.startsWith('Added by the dividend import') && { note: null }),
              }),
            },
          });
        }
        if (diff !== 0 || had.holding.archived || Number(before?.price) !== r.price) updated++;
        else unchanged++;
      }
      if (input.sellMissing) {
        const inFile = new Set(rows.map((r) => r.symbol));
        for (const e of mine.values()) {
          if (e.units <= 0 || inFile.has(e.key)) continue;
          await tx.holdingTrade.create({
            data: {
              holdingId: e.holding.id,
              date: today,
              type: 'sell',
              units: e.units,
              amount: e.value ?? 0,
            },
          });
          sold++;
        }
      }
      if (input.retireAssetId) {
        await tx.assetValuation.create({
          data: {
            assetId: input.retireAssetId,
            date: today,
            value: 0,
            note: 'Now counted as investments (imported holdings)',
          },
        });
      }
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
  return { created, updated, unchanged, sold };
}

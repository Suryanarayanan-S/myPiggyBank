/**
 * Dividends and interest from Zerodha Console's reports, recorded on the person's holdings. A
 * payout already recorded (same holding, day, kind and amount) is skipped, so a report can be
 * imported again; one for a share no longer held goes on an archived holding of that name, so
 * the year's income adds up like Console's.
 */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { kindOf, plainSymbol, readBrokerIncome } from '../domain/brokerHoldings.js';
import { decodeText, parseCsv } from '../domain/csv.js';
import { formatDay, parseDay } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { MAX_FILE_CHARS } from './holdingImportService.js';
import { assertMember } from './ownership.js';

const CURRENCY = 'INR';
const MAX_ROWS = 2_000;

export const IncomeImportInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(MAX_FILE_CHARS),
  /** Whose demat the report is for (null: shared). */
  ownerMemberId: z.uuid().nullable(),
});
type Input = z.output<typeof IncomeImportInput>;

function readFile(input: Input) {
  // Console's reports are comma-separated (a title line above would mislead the guess).
  const { rows } = parseCsv(decodeText(Buffer.from(input.data, 'base64')), ',');
  if (rows.length - 1 > MAX_ROWS) {
    throw new AppError(400, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} rows per file`);
  }
  try {
    return readBrokerIncome(rows);
  } catch (e) {
    throw new AppError(400, 'INVALID_INCOME_FILE', (e as Error).message);
  }
}

/** NSE market (series) codes Kite may append to a symbol ("PGINVIT-IV", "SGBFEB32IV-GB"). */
const MARKET_SUFFIX = /-(EQ|BE|BZ|BL|GB|IV|RR|RE|SM|ST|N[0-9A-Z])$/;

/** Every rupee holding in the family, with its payouts and owner. */
async function rupeeHoldings(db: Db, familyId: string) {
  return db.holding.findMany({
    where: { familyId, currency: CURRENCY, symbol: { not: null } },
    include: {
      trades: { where: { type: { in: ['dividend', 'interest'] } } },
      owner: { select: { name: true } },
    },
    orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }],
  });
}
type Held = Awaited<ReturnType<typeof rupeeHoldings>>[number];

/** Holdings by symbol as Console writes it (Kite's market suffix dropped), open ones first. */
function bySymbol(rows: Held[]) {
  const map = new Map<string, Held[]>();
  for (const h of rows) {
    const key = plainSymbol(h.symbol!).replace(MARKET_SUFFIX, '');
    map.set(key, [...(map.get(key) ?? []), h]);
  }
  return map;
}

const payoutKey = (date: string, type: string, amount: number) => `${date}|${type}|${amount}`;

async function plan(db: Db, familyId: string, input: Input) {
  if (input.ownerMemberId) await assertMember(db, familyId, input.ownerMemberId);
  const file = readFile(input);
  const all = await rupeeHoldings(db, familyId);
  const mine = bySymbol(all.filter((h) => h.ownerMemberId === input.ownerMemberId));
  const others = bySymbol(all.filter((h) => h.ownerMemberId !== input.ownerMemberId));
  // How often each payout is already recorded on any of the person's holdings of that symbol
  // (an archived one and a new one alike), so a report never adds it twice — and two equal
  // payouts on one day in the file are both kept.
  const recordedCount = new Map<string, number>();
  for (const [symbol, list] of mine) {
    for (const t of list.flatMap((h) => h.trades)) {
      const key = `${symbol}|${payoutKey(formatDay(t.date), t.type, Number(t.amount))}`;
      recordedCount.set(key, (recordedCount.get(key) ?? 0) + 1);
    }
  }
  const rows = file.rows.map((r) => {
    const key = `${r.symbol}|${payoutKey(r.date, file.kind, r.amount)}`;
    const left = recordedCount.get(key) ?? 0;
    if (left > 0) recordedCount.set(key, left - 1);
    return { ...r, holdingId: mine.get(r.symbol)?.[0]?.id ?? null, recorded: left > 0 };
  });
  // Not the person's but someone else's in the family: perhaps the wrong person was chosen.
  const heldByOthers = [
    ...new Set(
      rows
        .filter((r) => !r.holdingId)
        .flatMap((r) => others.get(r.symbol) ?? [])
        .map((h) => h.owner?.name ?? 'Shared'),
    ),
  ];
  return { kind: file.kind, rows, errors: file.errors, heldByOthers };
}

export async function previewIncomeImport(prisma: PrismaClient, familyId: string, input: Input) {
  const p = await plan(prisma, familyId, input);
  const fresh = p.rows.filter((r) => !r.recorded);
  return {
    kind: p.kind,
    rows: p.rows.map((r) => ({
      symbol: r.symbol,
      date: r.date,
      amount: r.amount,
      status: r.recorded ? ('recorded' as const) : ('new' as const),
      /** not among the person's holdings: it goes on an archived holding of that name */
      held: r.holdingId !== null,
    })),
    total: p.rows.reduce((t, r) => t + r.amount, 0),
    toAdd: { count: fresh.length, amount: fresh.reduce((t, r) => t + r.amount, 0) },
    newHoldings: [...new Set(fresh.filter((r) => !r.holdingId).map((r) => r.symbol))],
    /** others in the family who hold symbols of the report this person does not */
    heldByOthers: p.heldByOthers,
    errors: p.errors,
  };
}

export async function commitIncomeImport(prisma: PrismaClient, familyId: string, input: Input) {
  // Read and write in one transaction, so importing twice at once cannot record a payout twice.
  return prisma.$transaction(async (tx) => {
    const p = await plan(tx, familyId, input);
    const created = new Map<string, string>();
    let added = 0;
    for (const r of p.rows.filter((x) => !x.recorded)) {
      let holdingId = r.holdingId ?? created.get(r.symbol);
      if (!holdingId) {
        const h = await tx.holding.create({
          data: {
            familyId,
            name: r.symbol,
            kind: kindOf(r.symbol),
            symbol: r.symbol,
            currency: CURRENCY,
            ownerMemberId: input.ownerMemberId,
            archived: true,
            note: 'Added by the dividend import: no longer held',
          },
        });
        holdingId = h.id;
        created.set(r.symbol, h.id);
      }
      await tx.holdingTrade.create({
        data: { holdingId, date: parseDay(r.date)!, type: p.kind, units: 0, amount: r.amount },
      });
      added++;
    }
    return {
      kind: p.kind,
      added,
      skipped: p.rows.length - added,
      newHoldings: [...created.keys()],
    };
  });
}

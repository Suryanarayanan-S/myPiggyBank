/**
 * A broker's full tradebook (Zerodha Console's format) brought onto the person's holdings: each
 * holding whose quantity the file explains gets its real trades (dates and prices) in place of
 * what it had — dividends, interest and prices stay. Anything the file does not explain is
 * listed and left alone; shares bought and sold entirely become archived holdings.
 */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { kindOf, nseSymbol, readBrokerTrades, type BrokerTrade } from '../domain/brokerHoldings.js';
import { decodeText, parseCsv } from '../domain/csv.js';
import { formatRate } from '../domain/currency.js';
import { parseDay } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { MAX_FILE_CHARS, dematOf, inDemat } from './holdingImportService.js';

const CURRENCY = 'INR';
const MAX_ROWS = 20_000;

/** Every rupee holding in the family. */
function rupeeHoldings(db: Db, familyId: string) {
  return db.holding.findMany({
    where: { familyId, currency: CURRENCY, symbol: { not: null } },
    include: { account: { select: { type: true, archived: true } } },
    orderBy: [{ archived: 'asc' }, { createdAt: 'asc' }],
  });
}
type Held = Awaited<ReturnType<typeof rupeeHoldings>>[number];

/** Holdings by symbol as Console writes it (Kite's market suffix dropped), open ones first. */
function bySymbol(rows: Held[]) {
  const map = new Map<string, Held[]>();
  for (const h of rows) {
    const key = nseSymbol(h.symbol!);
    map.set(key, [...(map.get(key) ?? []), h]);
  }
  return map;
}

export const TradebookImportInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(MAX_FILE_CHARS),
  /** Whose demat the tradebook is for (null: shared). */
  ownerMemberId: z.uuid().nullable(),
  /** The demat account it is for: its owner decides whose the holdings are. */
  accountId: z.uuid().nullable().optional(),
});
type Input = z.output<typeof TradebookImportInput>;

function readFile(input: Input) {
  const { rows } = parseCsv(decodeText(Buffer.from(input.data, 'base64')), ',');
  if (rows.length - 1 > MAX_ROWS) {
    throw new AppError(400, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} trades per file`);
  }
  try {
    return readBrokerTrades(rows);
  } catch (e) {
    throw new AppError(400, 'INVALID_TRADEBOOK', (e as Error).message);
  }
}

type Action = 'replace' | 'history' | 'mismatch' | 'not-held' | 'oversold' | 'several';

async function plan(db: Db, familyId: string, input: Input) {
  const demat = await dematOf(db, familyId, input);
  const file = readFile(input);
  const all = await rupeeHoldings(db, familyId);
  const mine = bySymbol(all.filter(inDemat(demat)));
  const units = new Map(
    (
      await db.holdingTrade.groupBy({
        by: ['holdingId', 'type'],
        where: { holdingId: { in: all.map((h) => h.id) }, type: { in: ['buy', 'sell'] } },
        _sum: { units: true },
      })
    ).map((g) => [`${g.holdingId}|${g.type}`, Number(g._sum.units ?? 0)]),
  );
  const heldUnits = (id: string) => (units.get(`${id}|buy`) ?? 0) - (units.get(`${id}|sell`) ?? 0);
  const groups = new Map<string, BrokerTrade[]>();
  for (const t of file.rows) groups.set(t.symbol, [...(groups.get(t.symbol) ?? []), t]);
  const symbols = [...groups].map(([symbol, trades]) => {
    // In date order: never more sold than bought at the end of a day (within a day the order
    // does not matter — an intraday sell may come before its buy).
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
    let run = 0;
    let oversold = false;
    sorted.forEach((t, i) => {
      run += t.type === 'buy' ? t.units : -t.units;
      if (run < 0 && sorted[i + 1]?.date !== t.date) oversold = true;
    });
    const list = mine.get(symbol) ?? [];
    const holding = list[0] ?? null;
    const held = holding ? heldUnits(holding.id) : 0;
    const action: Action = oversold
      ? 'oversold'
      : list.length > 1
        ? // two holdings of one symbol (e.g. a sold one archived and a new one): which trades
          // belong where cannot be told — never guessed, so nothing is counted twice
          'several'
        : holding
          ? run === held
            ? 'replace'
            : 'mismatch'
          : run === 0
            ? 'history'
            : 'not-held';
    return { symbol, trades: sorted, fileUnits: run, held, holding, action };
  });
  const inFile = new Set(groups.keys());
  const notInFile = [...mine]
    .filter(([symbol, list]) => !inFile.has(symbol) && list.some((h) => heldUnits(h.id) > 0))
    .map(([, list]) => list.find((h) => heldUnits(h.id) > 0)!.symbol!);
  return { demat, symbols, notInFile, errors: file.errors };
}

const REASON: Record<Action, string> = {
  replace: 'its trades are replaced by the file’s (a tradebook has no charges)',
  several: 'more than one holding of this symbol — left alone',
  history: 'bought and sold entirely: kept as an archived holding',
  mismatch: 'the file does not add up to the units held — left alone',
  'not-held': 'not among the holdings — left out',
  oversold: 'sells more than it buys (a trade is missing) — left out',
};

export async function previewTradebookImport(prisma: PrismaClient, familyId: string, input: Input) {
  const p = await plan(prisma, familyId, input);
  const dates = p.symbols.flatMap((s) => s.trades.map((t) => t.date)).sort();
  return {
    trades: p.symbols.reduce((n, s) => n + s.trades.length, 0),
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    symbols: p.symbols
      .map((s) => ({
        symbol: s.symbol,
        trades: s.trades.length,
        fileUnits: formatRate(s.fileUnits),
        heldUnits: formatRate(s.held),
        action: s.action,
        reason: REASON[s.action],
      }))
      .sort((a, b) => a.action.localeCompare(b.action) || a.symbol.localeCompare(b.symbol)),
    /** held, but not in the file: left as they are */
    notInFile: p.notInFile,
    errors: p.errors,
  };
}

export async function commitTradebookImport(prisma: PrismaClient, familyId: string, input: Input) {
  return prisma.$transaction(
    async (tx) => {
      const p = await plan(tx, familyId, input);
      let replaced = 0;
      let history = 0;
      const data = (holdingId: string, trades: BrokerTrade[]) =>
        trades.map((t) => ({
          holdingId,
          date: parseDay(t.date)!,
          type: t.type,
          units: t.units,
          amount: t.amount,
        }));
      for (const s of p.symbols) {
        if (s.action === 'replace') {
          // dividends and interest stay; buys and sells are the file's
          await tx.holdingTrade.deleteMany({
            where: { holdingId: s.holding!.id, type: { in: ['buy', 'sell'] } },
          });
          await tx.holdingTrade.createMany({ data: data(s.holding!.id, s.trades) });
          const h = s.holding!;
          if (
            p.demat.accountId &&
            (h.accountId !== p.demat.accountId || h.ownerMemberId !== p.demat.owner)
          ) {
            await tx.holding.update({
              where: { id: h.id },
              data: { accountId: p.demat.accountId, ownerMemberId: p.demat.owner },
            });
          }
          replaced++;
        } else if (s.action === 'history') {
          const h = await tx.holding.create({
            data: {
              familyId,
              name: s.symbol,
              kind: kindOf(s.symbol),
              symbol: s.symbol,
              currency: CURRENCY,
              ownerMemberId: p.demat.owner,
              accountId: p.demat.accountId,
              archived: true,
              note: 'Added by the tradebook import: sold',
            },
          });
          await tx.holdingTrade.createMany({ data: data(h.id, s.trades) });
          history++;
        }
      }
      return {
        replaced,
        history,
        skipped: p.symbols.filter((s) => s.action !== 'replace' && s.action !== 'history').length,
      };
    },
    // a few thousand trades: more than the default five seconds on a slow disk
    { timeout: 60_000 },
  );
}

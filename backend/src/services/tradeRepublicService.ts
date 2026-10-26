/**
 * A Trade Republic transactions export brought into a broker account (an account of the type
 * Investment in the export's currency): each security, by ISIN, becomes a holding of the
 * account's owner in that account. Every row is imported once (its transaction id is kept), so
 * a later export that overlaps adds only what is new.
 */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { decodeText, parseCsv } from '../domain/csv.js';
import { formatRate } from '../domain/currency.js';
import { readTradeRepublic, type TradeRepublicRow } from '../domain/tradeRepublic.js';
import { formatDay, parseDay } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { INCLUDED, scale } from './corporateActionService.js';
import { MAX_FILE_CHARS } from './holdingImportService.js';
import { assertAccount } from './ownership.js';

const MAX_ROWS = 20_000;
/**
 * Trade Republic counts shares to ten places, the app to six: a few micro-units off after many
 * fractional buys (three savings-plan buys of 0.3333333333 sold as 1) is rounding, not a sale
 * of more than was bought.
 */
const DUST = 10n;

export const TradeRepublicInput = z.object({
  fileName: z.string().max(200),
  data: z.string().max(MAX_FILE_CHARS),
  /** the broker account it goes into: its owner decides whose the holdings are */
  accountId: z.uuid(),
});
type Input = z.output<typeof TradeRepublicInput>;

function readFile(input: Input) {
  const { rows } = parseCsv(decodeText(Buffer.from(input.data, 'base64')), ',');
  if (rows.length - 1 > MAX_ROWS) {
    throw new AppError(400, 'TOO_MANY_ROWS', `At most ${MAX_ROWS} rows per file`);
  }
  try {
    return readTradeRepublic(rows);
  } catch (e) {
    throw new AppError(400, 'INVALID_EXPORT', (e as Error).message);
  }
}

type Status = 'new' | 'held' | 'oversold';

async function plan(db: Db, familyId: string, input: Input) {
  const account = await assertAccount(db, familyId, input.accountId);
  const file = readFile(input);
  const currencies = [...new Set(file.rows.map((r) => r.currency))];
  if (account.type !== 'investment' || account.archived) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose an open account of the type Investment');
  }
  if (currencies.some((c) => c !== account.currency)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `The export is in ${currencies.join(', ')}: choose an investment account in that currency`,
    );
  }
  const holdings = await db.holding.findMany({
    where: {
      familyId,
      accountId: account.id,
      symbol: { in: [...new Set(file.rows.map((r) => r.isin))] },
    },
    include: {
      trades: { select: { ref: true, date: true, type: true, units: true } },
      actions: { where: { status: { in: INCLUDED } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map<string, TradeRepublicRow[]>();
  for (const r of file.rows) groups.set(r.isin, [...(groups.get(r.isin) ?? []), r]);
  const securities = [...groups].map(([isin, rows]) => {
    const holding = holdings.find((h) => h.symbol === isin) ?? null;
    const known = new Set(holding?.trades.map((t) => t.ref).filter(Boolean));
    // a row before a split applied since comes in the new units, like the trades already there
    const fresh = rows
      .filter((r) => !known.has(r.ref))
      .map((r) => {
        let units = BigInt(r.units);
        for (const a of holding?.actions ?? []) {
          if (a.num && a.den && r.date < formatDay(a.exDate)) units = scale(units, a.num, a.den);
        }
        return { ...r, units };
      });
    // never more sold than held at the end of a day, old and new trades together
    const moves = [
      ...(holding?.trades ?? []).map((t) => ({
        date: formatDay(t.date),
        type: t.type,
        units: t.units,
      })),
      ...fresh,
    ]
      .filter((t) => t.type === 'buy' || t.type === 'sell')
      .sort((a, b) => a.date.localeCompare(b.date));
    let held = 0n;
    let oversold = false;
    moves.forEach((t, i) => {
      held += t.type === 'buy' ? t.units : -t.units;
      if (held < -DUST && moves[i + 1]?.date !== t.date) oversold = true;
    });
    const status: Status = oversold ? 'oversold' : holding ? 'held' : 'new';
    return {
      isin,
      name: rows[0]!.name,
      kind: rows[0]!.kind,
      holding,
      fresh,
      known: rows.length - fresh.length,
      units: held,
      status,
    };
  });
  return { account, file, securities };
}

export async function previewTradeRepublic(prisma: PrismaClient, familyId: string, input: Input) {
  const p = await plan(prisma, familyId, input);
  const dates = p.file.rows.map((r) => r.date).sort();
  return {
    currency: p.account.currency,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    holdings: p.securities.map((s) => ({
      isin: s.isin,
      name: s.name,
      status: s.status,
      trades: s.fresh.filter((r) => r.type !== 'dividend').length,
      dividends: s.fresh.filter((r) => r.type === 'dividend').length,
      /** rows imported before */
      known: s.known,
      /** units held once imported */
      units: formatRate(Number(s.units)),
    })),
    skipped: p.file.skipped,
    errors: p.file.errors,
  };
}

export async function commitTradeRepublic(prisma: PrismaClient, familyId: string, input: Input) {
  return prisma.$transaction(
    async (tx) => {
      const p = await plan(tx, familyId, input);
      let created = 0;
      let added = 0;
      let known = 0;
      for (const s of p.securities) {
        if (s.status === 'oversold') continue;
        known += s.known;
        if (s.fresh.length === 0) continue;
        const id =
          s.holding?.id ??
          (
            await tx.holding.create({
              data: {
                familyId,
                name: s.name,
                kind: s.kind,
                symbol: s.isin,
                currency: p.account.currency,
                ownerMemberId: p.account.ownerMemberId,
                accountId: p.account.id,
                note: 'Imported from Trade Republic',
              },
            })
          ).id;
        if (!s.holding) created++;
        await tx.holdingTrade.createMany({
          data: s.fresh.map((r) => ({
            holdingId: id,
            date: parseDay(r.date)!,
            type: r.type,
            units: r.units,
            amount: r.amount,
            fees: r.fees,
            ref: r.ref,
          })),
        });
        added += s.fresh.length;
      }
      return { created, added, known };
    },
    { timeout: 60_000 },
  );
}

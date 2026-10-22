/**
 * Splits, bonus issues and consolidations from NSE's daily corporate-actions list, applied to
 * the holdings they concern: units held before the ex-date are multiplied by the factor and the
 * prices before it divided by it (money paid stays as it was), so a split never reads as a loss.
 * Whenever that could be wrong — the holding was entered or traded after the ex-date, another
 * unit change came close to it, or there is no factor (a demerger) — the user is asked to check
 * instead; units are never changed twice.
 */
import type { PrismaClient } from '@prisma/client';
import { prName, readCorporateActions } from '../domain/corporateActions.js';
import { plainSymbol } from '../domain/brokerHoldings.js';
import { readZipEntry } from '../domain/zip.js';
import { addDays, formatDay, parseDay } from '../lib/dates.js';
import type { FetchText } from './livePriceService.js';

/** How far back a server that was off catches up (lists name ex-dates about a week ahead). */
const CATCH_UP_DAYS = 45;
/** Lists read per run at most (oldest first): be gentle with NSE. */
const LISTS_PER_RUN = 10;
/** Actions older than this are not applied any more. */
const APPLY_DAYS = 60;
/** Two unit changes this close together are one event worded twice, or too unusual to guess. */
const SAME_EVENT_DAYS = 30;
const MARK = 'nse-corporate-actions';
const DAY_MS = 86_400_000;

// Days without a list (holidays), not asked again while the server runs.
const noList = new Set<string>();
export function forgetCorporateActions() {
  noList.clear();
}

/** NSE keeps the PR zips under …/archives/equities/bhavcopy/pr (next to …/products/content). */
const prUrl = (base: string) =>
  base.endsWith('/products/content')
    ? `${base.slice(0, -'/products/content'.length)}/archives/equities/bhavcopy/pr`
    : `${base}/pr`;

/**
 * Stores the actions of the lists not read yet, from the day after the last one read (at most
 * CATCH_UP_DAYS back) up to `latest`. A day whose list fails is retried next run; the others
 * are still read.
 */
export async function storeCorporateActions(
  prisma: PrismaClient,
  fetchText: FetchText,
  baseUrl: string,
  latest: string,
) {
  const mark = await prisma.fetchMark.findUnique({ where: { name: MARK } });
  const floor = addDays(latest, -CATCH_UP_DAYS);
  const after = mark ? addDays(formatDay(mark.day), 1) : addDays(latest, -6);
  let day = after > floor ? after : floor;
  const failures: string[] = [];
  let read = 0;
  // The mark only moves over days that are done, so a failed day is asked again.
  let done = mark ? formatDay(mark.day) : null;
  for (; day <= latest && read < LISTS_PER_RUN; day = addDays(day, 1)) {
    const weekday = parseDay(day)!.getUTCDay();
    const settled = weekday === 0 || weekday === 6 || noList.has(day);
    if (!settled) {
      read++;
      try {
        const res = await fetchText(`${prUrl(baseUrl)}/${prName(day)}`);
        if (res.status === 404) {
          // the latest day's list may simply not be out yet: only older days count as holidays
          if (day === latest) break;
          noList.add(day);
        } else {
          if (!res.ok || !res.arrayBuffer) throw new Error(`NSE answered ${res.status}`);
          const text = readZipEntry(Buffer.from(await res.arrayBuffer()), (n) =>
            /^bc\d{6}(\d{2})?\.csv$/i.test(n),
          );
          if (text === null) throw new Error('its daily archive has no list of corporate actions');
          for (const a of readCorporateActions(text)) {
            const exDate = parseDay(a.exDate)!;
            await prisma.corporateAction.upsert({
              where: { symbol_exDate_purpose: { symbol: a.symbol, exDate, purpose: a.purpose } },
              create: { ...a, exDate },
              update: { kind: a.kind, num: a.num, den: a.den },
            });
          }
        }
      } catch (err) {
        failures.push(`${day}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    if (failures.length === 0) done = day;
  }
  if (done && done !== (mark ? formatDay(mark.day) : null)) {
    await prisma.fetchMark.upsert({
      where: { name: MARK },
      create: { name: MARK, day: parseDay(done)! },
      update: { day: parseDay(done)! },
    });
  }
  if (failures.length) throw new Error(failures.join('; '));
}

type Trade = { date: Date; type: string; units: bigint; createdAt: Date };
const moves = (t: { type: string }) => t.type === 'buy' || t.type === 'sell';
const unitsBefore = (trades: Trade[], exDate: Date) =>
  trades
    .filter((t) => moves(t) && t.date < exDate)
    .reduce((s, t) => s + (t.type === 'buy' ? t.units : -t.units), 0n);
const scale = (n: bigint, num: number, den: number) =>
  (n * BigInt(num) + BigInt(den) / 2n) / BigInt(den);
const changesUnits = (kind: string) => kind !== 'review';

/**
 * Applies the stored actions with an ex-date up to `upTo` to these families' held rupee
 * holdings, once each. Adjusted only when that is surely right; otherwise recorded for the user
 * to check (see the file's comment).
 */
export async function applyCorporateActions(
  prisma: PrismaClient,
  familyIds: string[],
  upTo: string,
) {
  const actions = await prisma.corporateAction.findMany({
    // dividends are income, not a change of units
    where: {
      exDate: { lte: parseDay(upTo)!, gte: parseDay(addDays(upTo, -APPLY_DAYS))! },
      kind: { not: 'dividend' },
      // what was looked back on (the history) is never applied: only NSE's daily list
      source: 'list',
    },
    orderBy: [{ exDate: 'asc' }, { purpose: 'asc' }],
  });
  if (actions.length === 0) return;
  const holdings = await prisma.holding.findMany({
    where: { familyId: { in: familyIds }, archived: false, currency: 'INR', symbol: { not: null } },
    select: { id: true, symbol: true, createdAt: true },
  });
  for (const h of holdings) {
    const symbol = plainSymbol(h.symbol!);
    for (const a of actions.filter((x) => x.symbol === symbol)) {
      await prisma.$transaction(async (tx) => {
        // Read inside the transaction: what this run (or a parallel edit) did before counts.
        const known = await tx.holdingAction.findMany({ where: { holdingId: h.id } });
        if (known.some((x) => +x.exDate === +a.exDate && x.purpose === a.purpose)) return;
        const trades = await tx.holdingTrade.findMany({ where: { holdingId: h.id } });
        const before = unitsBefore(trades, a.exDate);
        if (before <= 0n) return; // not held when it happened
        const record = {
          holdingId: h.id,
          exDate: a.exDate,
          purpose: a.purpose,
          kind: a.kind,
          num: a.num,
          den: a.den,
          unitsBefore: before,
        };
        const earlier = trades.filter((t) => moves(t) && t.date < a.exDate);
        const doubt =
          a.kind === 'review' ||
          a.num === null ||
          a.den === null ||
          // bought or sold since: an import may already show the new units
          trades.some((t) => moves(t) && t.date >= a.exDate) ||
          // entered after the ex-date: probably already in the new units
          h.createdAt >= a.exDate ||
          earlier.some((t) => t.createdAt >= a.exDate) ||
          // another unit change close by: the same event worded twice, or two at once
          (changesUnits(a.kind) &&
            known.some(
              (x) =>
                changesUnits(x.kind) && Math.abs(+x.exDate - +a.exDate) <= SAME_EVENT_DAYS * DAY_MS,
            ));
        if (doubt) {
          await tx.holdingAction.create({
            data: { ...record, status: 'review', unitsAfter: before },
          });
          return;
        }
        const { num, den } = a as { num: number; den: number };
        for (const t of earlier) {
          await tx.holdingTrade.update({
            where: { id: t.id },
            data: { units: scale(t.units, num, den) },
          });
        }
        const prices = await tx.holdingPrice.findMany({
          where: { holdingId: h.id, date: { lt: a.exDate } },
        });
        for (const p of prices) {
          await tx.holdingPrice.update({
            where: { id: p.id },
            data: { price: scale(p.price, den, num) },
          });
        }
        await tx.holdingAction.create({
          data: {
            ...record,
            status: 'applied',
            unitsAfter: earlier.reduce(
              (s, t) => s + (t.type === 'buy' ? 1n : -1n) * scale(t.units, num, den),
              0n,
            ),
          },
        });
      });
    }
  }
}

/**
 * A close for a day before an applied split, filled in later (past days are fetched after the
 * latest one): divided like the prices that were there when the split was applied.
 */
export function adjustedClose(
  price: number,
  day: string,
  applied: { exDate: Date; status: string; num: number | null; den: number | null }[],
): number {
  let p = BigInt(price);
  for (const a of applied) {
    if (a.status === 'applied' && a.num && a.den && formatDay(a.exDate) > day) {
      p = scale(p, a.den, a.num);
    }
  }
  return Number(p);
}

/**
 * Units a broker file may still show for a holding just after an applied split or bonus (the
 * new shares are credited a few days later): the count before it. Such a file is not a sale.
 */
export function awaitingCredit(
  applied: { exDate: Date; status: string; unitsBefore: bigint }[],
  fileUnits: number,
  today: string,
): boolean {
  const since = parseDay(addDays(today, -SAME_EVENT_DAYS))!;
  return applied.some(
    (a) => a.status === 'applied' && a.exDate >= since && Number(a.unitsBefore) === fileUnits,
  );
}

/**
 * Looking back with NSE's corporate-action history: every dividend (and InvIT distribution)
 * since the first trade, worked out like a broker does (shares held at the close before the
 * ex-date × amount per share), gold bond interest, and what each split, bonus, demerger or merger
 * did to a holding (shares and value just before and just after).
 */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { bhavcopyName, priceFor, readBhavcopy, type Bhavcopy } from '../domain/bhavcopy.js';
import { plainSymbol } from '../domain/brokerHoldings.js';
import { formerSymbols, readNseHistory, readSymbolChanges } from '../domain/corporateActions.js';
import { addMonths } from '../domain/deposits.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import { assertMember } from './ownership.js';
import type { FetchText } from './livePriceService.js';

/** NSE's website API for a symbol's corporate actions. */
export const DEFAULT_HISTORY_URL = 'https://www.nseindia.com/api/corporates-corporateActions';
/** A symbol's history is asked again after a week. */
const REFRESH_DAYS = 7;
/** NSE market codes Kite may append ("PGINVIT-IV"); not RE (a rights entitlement). */
const MARKET_SUFFIX = /-(EQ|BE|BZ|BL|GB|IV|RR|SM|ST|N[0-9A-Z])$/;
const nseSymbol = (s: string) => plainSymbol(s).replace(MARKET_SUFFIX, '');
const CURRENCY = 'INR';

export const LookbackInput = z.object({ ownerMemberId: z.uuid().nullable() });

export type Sources = {
  fetch: FetchText;
  historyUrl: string;
  pricesUrl: string;
  /** pause between requests (be gentle with NSE); 0 in tests */
  pauseMs?: number;
  /** daily files read in this run (null: none for that day), so each is downloaded once */
  files?: Map<string, Bhavcopy | null>;
};

const dmy = (day: string) => `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The person's (or, undefined, everyone's) rupee holdings with a symbol, and their NSE name. */
async function holdingsOf(db: Db, familyId: string, owner: string | null | undefined) {
  const rows = await db.holding.findMany({
    where: {
      familyId,
      currency: CURRENCY,
      symbol: { not: null },
      ...(owner !== undefined && { ownerMemberId: owner }),
    },
    include: {
      trades: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
      // splits the app could not apply (left to check): the trades may be in the old units
      actions: { where: { status: 'review' }, select: { exDate: true } },
    },
  });
  return rows.map((h) => ({ ...h, nse: nseSymbol(h.symbol!) }));
}
type Held = Awaited<ReturnType<typeof holdingsOf>>[number];

/**
 * Fetches the history of these symbols since `from` — again after a week, or when an earlier
 * start is wanted; says which failed and why.
 */
async function refreshHistory(
  prisma: PrismaClient,
  src: Sources,
  symbols: string[],
  from: string,
  today: string,
) {
  const failed: { symbol: string; reason: string }[] = [];
  for (const symbol of symbols) {
    const name = `nse-history:${symbol}`;
    const fromName = `nse-history-from:${symbol}`;
    const [mark, since] = await Promise.all([
      prisma.fetchMark.findUnique({ where: { name } }),
      prisma.fetchMark.findUnique({ where: { name: fromName } }),
    ]);
    const fresh = mark && formatDay(mark.day) > addDays(today, -REFRESH_DAYS);
    if (fresh && since && formatDay(since.day) <= from) continue;
    try {
      const url = `${src.historyUrl}?index=equities&symbol=${encodeURIComponent(symbol)}&from_date=${dmy(from)}&to_date=${dmy(today)}`;
      const res = await src.fetch(url);
      if (!res.ok) throw new Error(`NSE answered ${res.status}`);
      for (const a of readNseHistory(JSON.parse(await res.text()))) {
        const exDate = parseDay(a.exDate)!;
        // Kept under the symbol held today; an older name (TATAMOTORS for TMPV) is remembered
        // for the prices from before the rename.
        if (a.symbol !== symbol) {
          await prisma.symbolAlias.upsert({
            where: { symbol_former: { symbol, former: a.symbol } },
            create: { symbol, former: a.symbol },
            update: {},
          });
        }
        const data = {
          kind: a.kind,
          num: a.num,
          den: a.den,
          amount: a.amount == null ? null : BigInt(a.amount),
        };
        await prisma.corporateAction.upsert({
          where: { symbol_exDate_purpose: { symbol, exDate, purpose: a.purpose } },
          // looked back on: never applied to the holdings (only the daily list's are)
          create: { symbol, exDate, purpose: a.purpose, source: 'history', ...data },
          update: data,
        });
      }
      for (const [n, d] of [
        [name, today],
        [fromName, from],
      ] as const) {
        await prisma.fetchMark.upsert({
          where: { name: n },
          create: { name: n, day: parseDay(d)! },
          update: { day: parseDay(d)! },
        });
      }
    } catch (err) {
      failed.push({ symbol, reason: err instanceof Error ? err.message : String(err) });
    }
    if (src.pauseMs) await pause(src.pauseMs);
  }
  return failed;
}

/** NSE keeps its symbol change list next to the daily files: …/products/content → …/content/equities. */
const changesUrl = (base: string) =>
  base.endsWith('/products/content')
    ? `${base.slice(0, -'/products/content'.length)}/content/equities/symbolchange.csv`
    : `${base}/symbolchange.csv`;

/** Remembers the former symbols of these shares (for prices from before a rename). */
async function refreshAliases(
  prisma: PrismaClient,
  src: Sources,
  symbols: string[],
  today: string,
) {
  const name = 'nse-symbol-changes';
  const mark = await prisma.fetchMark.findUnique({ where: { name } });
  if (mark && formatDay(mark.day) === today) return;
  try {
    const res = await src.fetch(changesUrl(src.pricesUrl));
    if (!res.ok) return;
    const changes = readSymbolChanges(await res.text());
    for (const symbol of symbols) {
      for (const former of formerSymbols(changes, symbol)) {
        await prisma.symbolAlias.upsert({
          where: { symbol_former: { symbol, former } },
          create: { symbol, former },
          update: {},
        });
      }
    }
    await prisma.fetchMark.upsert({
      where: { name },
      create: { name, day: parseDay(today)! },
      update: { day: parseDay(today)! },
    });
  } catch {
    // without it, prices from before a rename are not found: said where they are missing
  }
}

type Action = Awaited<ReturnType<PrismaClient['corporateAction']['findMany']>>[number];
/**
 * One row per event: NSE's daily list and its website word the same split differently
 * ("FACE VALUE SPLIT…" / "Face Value Split…"); a dividend is kept per wording (two can share a day).
 */
const distinct = (actions: Action[]) => {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key =
      a.kind === 'dividend'
        ? `${a.symbol}|${+a.exDate}|dividend|${a.purpose.toLowerCase()}`
        : `${a.symbol}|${+a.exDate}|${a.kind}|${a.num}|${a.den}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const isUnitChange = (a: Action) => ['split', 'bonus', 'consolidation'].includes(a.kind);
const moves = (t: { type: string }) => t.type === 'buy' || t.type === 'sell';

/**
 * The free shares of a bonus (or split) recorded as their own lot around the ex-date (as Paytm
 * Money does): then the trades before it are in the units of their day.
 */
const ownLot = (h: Held, ex: string) =>
  h.trades.some((t) => {
    const d = formatDay(t.date);
    return (
      t.type === 'buy' && Number(t.amount) === 0 && d >= addDays(ex, -3) && d <= addDays(ex, 10)
    );
  });

/**
 * Units held at the close of `day`, in that day's units. Trades are usually kept in today's
 * units (a split or bonus restates the earlier ones): before a later one, fewer were held — unless
 * its free shares are a lot of their own.
 */
function unitsOn(h: Held, day: string, actions: Action[]) {
  let units = h.trades
    .filter((t) => moves(t) && formatDay(t.date) <= day)
    .reduce((s, t) => s + (t.type === 'buy' ? Number(t.units) : -Number(t.units)), 0);
  for (const a of actions) {
    const ex = formatDay(a.exDate);
    // not applied by the app (left to check): the earlier trades may still be in the old units
    const unapplied = h.actions.some((x) => formatDay(x.exDate) === ex);
    if (
      isUnitChange(a) &&
      a.symbol === h.nse &&
      ex > day &&
      a.num &&
      a.den &&
      !ownLot(h, ex) &&
      !unapplied
    ) {
      units = (units * a.den) / a.num;
    }
  }
  return Math.max(0, Math.round(units));
}

type Payout = {
  holdingId: string;
  symbol: string;
  date: string;
  /** micro-units held when it was earned */
  units: number;
  /** micros a share */
  perShare: number;
  /** paise */
  amount: number;
  kind: 'dividend' | 'interest';
  recorded: boolean;
};

async function plan(prisma: PrismaClient, familyId: string, owner: string | null, src: Sources) {
  if (owner) await assertMember(prisma, familyId, owner);
  const today = todayLocal();
  const holdings = (await holdingsOf(prisma, familyId, owner)).filter((h) => h.trades.some(moves));
  const firstTrade = (h: Held) => formatDay(h.trades.find(moves)!.date);
  const symbols = [...new Set(holdings.filter((h) => !h.nse.startsWith('SGB')).map((h) => h.nse))];
  const from = holdings.map(firstTrade).sort()[0] ?? today;
  const failed = await refreshHistory(prisma, src, symbols, from, today);
  await refreshAliases(prisma, src, symbols, today);
  const actions = distinct(
    await prisma.corporateAction.findMany({
      where: { symbol: { in: symbols } },
      orderBy: [{ exDate: 'asc' }, { purpose: 'asc' }],
    }),
  );
  // What the person already has: per holding and day, and per day and amount (a payout may sit
  // on a renamed or archived holding of the same share).
  const recordedOn = new Set<string>();
  const recordedAmount = new Set<string>();
  for (const h of holdings) {
    for (const t of h.trades) {
      if (t.type !== 'dividend' && t.type !== 'interest') continue;
      recordedOn.add(`${h.id}|${formatDay(t.date)}`);
      recordedAmount.add(`${formatDay(t.date)}|${Number(t.amount)}`);
    }
  }
  const payouts: Payout[] = [];
  // gold bond interest recorded a few days off (a holiday moves the payment): the same one
  const interestNear = (holdingId: string, day: string) =>
    holdings
      .find((h) => h.id === holdingId)!
      .trades.some(
        (t) =>
          t.type === 'interest' &&
          Math.abs(Date.parse(formatDay(t.date)) - Date.parse(day)) <= 10 * 86_400_000,
      );
  const add = (p: Omit<Payout, 'recorded'>) => {
    if (p.amount <= 0) return;
    const recorded =
      recordedOn.has(`${p.holdingId}|${p.date}`) ||
      recordedAmount.has(`${p.date}|${p.amount}`) ||
      (p.kind === 'interest' && interestNear(p.holdingId, p.date));
    payouts.push({ ...p, recorded });
  };
  for (const h of holdings) {
    const start = firstTrade(h);
    // dividends: shares held at the close before the ex-date
    for (const a of actions) {
      if (a.kind !== 'dividend' || a.symbol !== h.nse || a.amount === null) continue;
      const ex = formatDay(a.exDate);
      if (ex <= start || ex > today) continue;
      const units = unitsOn(h, addDays(ex, -1), actions);
      if (units <= 0) continue;
      const perShare = Number(a.amount);
      add({
        holdingId: h.id,
        symbol: h.nse,
        date: ex,
        units,
        perShare,
        // units are micro-units, perShare micros: paise = units × perShare / 10^10
        amount: Math.round((units / 1_000_000) * (perShare / 10_000)),
        kind: 'dividend',
      });
    }
    // gold bonds: the last recorded interest, every six months back to the buy
    if (h.nse.startsWith('SGB')) {
      const last = [...h.trades].reverse().find((t) => t.type === 'interest');
      if (!last) continue;
      const lastDay = formatDay(last.date);
      const unitsThen = unitsOn(h, addDays(lastDay, -1), []);
      if (unitsThen <= 0) continue;
      const perUnit = Number(last.amount) / (unitsThen / 1_000_000); // paise a bond
      for (let k = 1; ; k++) {
        const day = addMonths(lastDay, -6 * k);
        if (day <= start) break;
        const units = unitsOn(h, addDays(day, -1), []);
        if (units <= 0) continue;
        add({
          holdingId: h.id,
          symbol: h.nse,
          date: day,
          units,
          perShare: Math.round(perUnit * 10_000),
          amount: Math.round((units / 1_000_000) * perUnit),
          kind: 'interest',
        });
      }
    }
  }
  payouts.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
  return { payouts, failed };
}

/** What would be added, by year (nothing is saved). */
export async function previewPastDividends(
  prisma: PrismaClient,
  familyId: string,
  owner: string | null,
  src: Sources,
) {
  const { payouts, failed } = await plan(prisma, familyId, owner, src);
  // the prices around splits and mergers, looked up now (the history page only reads them)
  await corporateEvents(prisma, familyId, owner, { ...src, files: new Map() });
  const years = new Map<
    string,
    { year: string; count: number; amount: number; recorded: number }
  >();
  for (const p of payouts) {
    const y = p.date.slice(0, 4);
    const row = years.get(y) ?? { year: y, count: 0, amount: 0, recorded: 0 };
    if (p.recorded) row.recorded++;
    else {
      row.count++;
      row.amount += p.amount;
    }
    years.set(y, row);
  }
  const fresh = payouts.filter((p) => !p.recorded);
  return {
    years: [...years.values()],
    toAdd: { count: fresh.length, amount: fresh.reduce((t, p) => t + p.amount, 0) },
    recorded: payouts.length - fresh.length,
    rows: fresh.map((p) => ({
      symbol: p.symbol,
      date: p.date,
      units: p.units / 1_000_000,
      perShare: p.perShare / 1_000_000,
      amount: p.amount,
      kind: p.kind,
    })),
    /** symbols whose history NSE did not give (e.g. listed on BSE only) */
    failed: failed.map((f) => f.symbol),
    /** why, when NSE itself failed (not just an unknown symbol) */
    problem: failed.find((f) => !/ 404$/.test(f.reason))?.reason ?? null,
  };
}

export async function commitPastDividends(
  prisma: PrismaClient,
  familyId: string,
  owner: string | null,
  src: Sources,
) {
  const { payouts } = await plan(prisma, familyId, owner, src);
  const fresh = payouts.filter((p) => !p.recorded);
  await prisma.holdingTrade.createMany({
    data: fresh.map((p) => ({
      holdingId: p.holdingId,
      date: parseDay(p.date)!,
      type: p.kind,
      units: 0,
      amount: p.amount,
    })),
  });
  return { added: fresh.length, amount: fresh.reduce((t, p) => t + p.amount, 0) };
}

/**
 * A day's close of a symbol (or of its former name): kept once found; without `src` only what is
 * kept. Each day's file is downloaded once per lookup; a missing file or a failure is no price.
 */
async function closeOn(prisma: PrismaClient, src: Sources | null, symbol: string, day: string) {
  const known = await prisma.marketClose.findUnique({
    where: { symbol_date: { symbol, date: parseDay(day)! } },
  });
  if (known) return Number(known.close);
  if (!src) return null;
  const files = (src.files ??= new Map());
  if (!files.has(day)) {
    let file: Bhavcopy | null = null;
    try {
      const res = await src.fetch(`${src.pricesUrl}/${bhavcopyName(day)}`);
      if (res.ok) {
        const read = readBhavcopy(await res.text());
        if (read.date === day) file = read;
      }
    } catch {
      // a timeout or an outage: no price that day
    }
    files.set(day, file);
    if (src.pauseMs) await pause(src.pauseMs);
  }
  const file = files.get(day);
  if (!file) return null;
  const formers = (await prisma.symbolAlias.findMany({ where: { symbol } })).map((a) => a.former);
  let close = priceFor(file, symbol);
  for (const f of formers) close ??= priceFor(file, f);
  if (close !== null) {
    await prisma.marketClose.create({
      data: { symbol, date: parseDay(day)!, close: BigInt(close) },
    });
  }
  return close;
}

/** The last close before `day` (or first on/after it), looking a few weeks at most. */
async function closeNear(
  prisma: PrismaClient,
  src: Sources | null,
  symbol: string,
  day: string,
  direction: -1 | 1,
  days = 10,
) {
  for (let i = direction < 0 ? 1 : 0; i <= days; i++) {
    const d = addDays(day, direction * i);
    const w = parseDay(d)!.getUTCDay();
    if (w === 0 || w === 6) continue;
    const c = await closeOn(prisma, src, symbol, d);
    if (c !== null) return { day: d, close: c };
  }
  return null;
}

/**
 * Splits, bonuses, demergers and mergers of the person's holdings: shares before and after, and
 * the value just before (the last close) and just after (the first close; new shares received
 * that day — e.g. a demerged company — included). Prices are looked up and kept the first time.
 */
export async function corporateEvents(
  prisma: PrismaClient,
  familyId: string,
  owner: string | null | undefined,
  src: Sources | null,
) {
  if (owner) await assertMember(prisma, familyId, owner);
  const today = todayLocal();
  const holdings = (await holdingsOf(prisma, familyId, owner)).filter((h) => h.trades.some(moves));
  const actions = distinct(
    await prisma.corporateAction.findMany({
      where: {
        symbol: { in: [...new Set(holdings.map((h) => h.nse))] },
        kind: { not: 'dividend' },
      },
      orderBy: [{ exDate: 'asc' }, { purpose: 'asc' }],
    }),
  );
  const events = [];
  // every holding of the share (two people, or two brokers, may hold it)
  for (const [a, h] of actions.flatMap((x) =>
    holdings.filter((y) => y.nse === x.symbol).map((y) => [x, y] as const),
  )) {
    const ex = formatDay(a.exDate);
    if (ex > today) continue;
    const before = unitsOn(h, addDays(ex, -1), actions);
    if (before <= 0) continue;
    const after = unitsOn(h, ex, actions);
    // new shares of another company received on the ex-date (a demerger, a merger)
    // A demerger or merger: the shares of another company that came with it — a holding whose
    // first shares are dated that very day (an allotment; a later buy is not one).
    const restructure = /demerg|amalgamat|merger|arrangement/i.test(a.purpose);
    const received = !restructure
      ? []
      : holdings
          .filter((x) => x.id !== h.id)
          .map((x) => {
            const buys = x.trades.filter((t) => t.type === 'buy');
            const first = buys[0] ? formatDay(buys[0].date) : '';
            return {
              symbol: x.nse,
              units:
                first === ex
                  ? buys
                      .filter((t) => formatDay(t.date) === first)
                      .reduce((s, t) => s + Number(t.units), 0)
                  : 0,
            };
          })
          .filter((x) => x.units > 0);
    // Worth comparing: a split or bonus (the same value in more shares), or a demerger or merger
    // with its new shares known. A rights issue changes nothing until taken up.
    const comparable = isUnitChange(a) || (restructure && received.length > 0);
    let valueBefore: number | null = null;
    let valueAfter: number | null = null;
    /** the day each received share was first priced (a demerged company may list weeks later) */
    const pricedOn = new Map<string, string>();
    if (comparable) {
      const b = await closeNear(prisma, src, a.symbol, ex, -1);
      const parentAfter = after > 0 ? await closeNear(prisma, src, a.symbol, ex, 1) : null;
      const kids = [];
      for (const r of received)
        // a demerged company may list weeks later
        kids.push({ ...r, near: await closeNear(prisma, src, r.symbol, ex, 1, 90) });
      for (const k of kids) if (k.near) pricedOn.set(k.symbol, k.near.day);
      if (b) valueBefore = Math.round((before / 1_000_000) * (b.close / 10_000));
      if ((after === 0 || parentAfter) && kids.every((k) => k.near)) {
        valueAfter =
          Math.round((after / 1_000_000) * ((parentAfter?.close ?? 0) / 10_000)) +
          kids.reduce(
            (t, k) => t + Math.round((k.units / 1_000_000) * (k.near!.close / 10_000)),
            0,
          );
      }
    }
    events.push({
      holdingId: h.id,
      symbol: a.symbol,
      exDate: ex,
      purpose: a.purpose,
      kind: a.kind,
      unitsBefore: before / 1_000_000,
      unitsAfter: after / 1_000_000,
      received: received.map((r) => ({
        symbol: r.symbol,
        units: r.units / 1_000_000,
        pricedOn: pricedOn.get(r.symbol) ?? null,
      })),
      /** a demerger or merger whose new shares could not be tied to it (no value then) */
      unlinked: restructure && received.length === 0,
      /** paise; null when the prices could not be had */
      valueBefore,
      valueAfter,
      change: valueBefore !== null && valueAfter !== null ? valueAfter - valueBefore : null,
    });
  }
  return events.reverse();
}

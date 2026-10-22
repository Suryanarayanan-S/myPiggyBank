/**
 * Looking back with NSE's corporate-action history: every dividend (and InvIT distribution)
 * since the first trade, worked out like a broker does (shares held at the close before the
 * ex-date × amount per share), gold bond interest, and what each split, bonus, demerger or merger
 * did to a holding (shares and value just before and just after).
 */
import type { PrismaClient } from '@prisma/client';
import { bhavcopyName, priceFor, readBhavcopy, type Bhavcopy } from '../domain/bhavcopy.js';
import { nseSymbol } from '../domain/brokerHoldings.js';
import { formerSymbols, readNseHistory, readSymbolChanges } from '../domain/corporateActions.js';
import { addMonths } from '../domain/deposits.js';
import { goldBond, goldBondInterest, interestPaise } from '../domain/goldBonds.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import type { Db } from '../lib/db.js';
import type { FetchText } from './livePriceService.js';

/** NSE's website API for a symbol's corporate actions. */
export const DEFAULT_HISTORY_URL = 'https://www.nseindia.com/api/corporates-corporateActions';
/** A symbol's history is asked again after a week. */
const REFRESH_DAYS = 7;
const CURRENCY = 'INR';

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
async function holdingsOf(db: Db, familyId: string) {
  const rows = await db.holding.findMany({
    where: {
      familyId,
      currency: CURRENCY,
      symbol: { not: null },
    },
    include: {
      trades: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
      // splits the app could not apply (left to check): the trades may be in the old units
      actions: { where: { status: 'review' }, select: { exDate: true } },
      removedPayouts: { select: { date: true, kind: true } },
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

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

/**
 * Which payouts are there already: recorded, or taken out by the person. Each entry stands for one
 * payout. The same day counts first (also on another holding of the person's when the amount
 * matches: the share renamed, or archived); then a dividend entered up to 45 days after
 * its ex-date (when it was paid, perhaps after tax), or interest within ten days (a holiday).
 */
function markRecorded(holdings: Held[], payouts: Payout[]) {
  type Entry = { day: string; kind: string; amount: number | null };
  const entries = new Map<string, Entry[]>();
  for (const h of holdings) {
    entries.set(h.id, [
      ...h.trades
        .filter((t) => t.type === 'dividend' || t.type === 'interest')
        .map((t) => ({ day: formatDay(t.date), kind: t.type, amount: Number(t.amount) })),
      ...h.removedPayouts.map((r) => ({ day: formatDay(r.date), kind: r.kind, amount: null })),
    ]);
  }
  const byId = new Map(holdings.map((h) => [h.id, h]));
  // the person's other holdings (the share renamed, or archived and bought again)
  const othersOf = (p: Payout) =>
    holdings.filter(
      (h) => h.id !== p.holdingId && h.ownerMemberId === byId.get(p.holdingId)!.ownerMemberId,
    );
  const take = (list: Entry[] | undefined, ok: (e: Entry) => boolean) => {
    const i = list?.findIndex(ok) ?? -1;
    if (i >= 0) list!.splice(i, 1);
    return i >= 0;
  };
  for (const p of payouts) {
    p.recorded =
      take(entries.get(p.holdingId), (e) => e.kind === p.kind && e.day === p.date) ||
      othersOf(p).some((h) =>
        take(
          entries.get(h.id),
          (e) => e.kind === p.kind && e.day === p.date && e.amount === p.amount,
        ),
      );
  }
  for (const p of payouts) {
    if (p.recorded) continue;
    p.recorded = take(entries.get(p.holdingId), (e) => {
      if (e.kind !== p.kind) return false;
      const d = daysBetween(p.date, e.day);
      return p.kind === 'dividend' ? d >= -3 && d <= 45 : Math.abs(d) <= 10;
    });
  }
}

async function plan(prisma: PrismaClient, familyId: string, src: Sources) {
  const today = todayLocal();
  const holdings = (await holdingsOf(prisma, familyId)).filter((h) => h.trades.some(moves));
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
  const payouts: Payout[] = [];
  const add = (p: Omit<Payout, 'recorded'>) => {
    if (p.amount > 0) payouts.push({ ...p, recorded: false });
  };
  for (const h of holdings) {
    const start = firstTrade(h);
    // Archived while still held (no sale recorded): nothing after its last trade. A split left to
    // check: nothing from it on, as the units then are not known.
    const lastMove = formatDay(h.trades.filter(moves).at(-1)!.date);
    const held = h.archived && unitsOn(h, today, []) > 0 ? lastMove : today;
    const review = h.actions.map((x) => formatDay(x.exDate)).sort()[0];
    const until = review && addDays(review, -1) < held ? addDays(review, -1) : held;
    // dividends: shares held at the close before the ex-date
    for (const a of actions) {
      if (a.kind !== 'dividend' || a.symbol !== h.nse || a.amount === null) continue;
      const ex = formatDay(a.exDate);
      if (ex <= start || ex > until) continue;
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
    // gold bonds: from the series' issue price and date
    const coupons = goldBondInterest(h.nse, addDays(start, 1), until);
    for (const c of coupons) {
      const units = unitsOn(h, addDays(c.exDate, -1), []);
      if (units <= 0) continue;
      add({
        holdingId: h.id,
        symbol: h.nse,
        date: c.exDate,
        units,
        perShare: c.perUnit,
        amount: interestPaise(units, c.perUnit),
        kind: 'interest',
      });
    }
    // a series not in the list: the last recorded interest, every six months back to the buy
    if (h.nse.startsWith('SGB') && !goldBond(h.nse)) {
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
  markRecorded(holdings, payouts);
  return { payouts, failed };
}

/** Families being checked now, and a check asked for while one ran (the data may have changed). */
const running = new Map<string, Promise<CheckResult>>();
const queued = new Map<string, Promise<CheckResult>>();
/** What the last check of each family could not look up (kept until the server restarts). */
const lastFailed = new Map<string, { failed: string[]; problem: string | null }>();
const checkedMark = (familyId: string) => `dividends-checked:${familyId}`;

type CheckResult = Awaited<ReturnType<typeof runCheck>>;

/** What a check added. */
const result = (fresh: Payout[]) => ({
  added: fresh.length,
  amount: fresh.reduce((t, p) => t + p.amount, 0),
  rows: fresh.map((p) => ({
    symbol: p.symbol,
    date: p.date,
    units: p.units / 1_000_000,
    perShare: p.perShare / 1_000_000,
    amount: p.amount,
    kind: p.kind,
  })),
});

async function runCheck(prisma: PrismaClient, familyId: string, src: Sources) {
  const files = new Map<string, Bhavcopy | null>();
  const { payouts, failed } = await plan(prisma, familyId, { ...src, files });
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
  // the prices around splits and mergers, looked up now (the history page only reads them)
  await corporateEvents(prisma, familyId, { ...src, files });
  const day = parseDay(todayLocal())!;
  const missing = {
    /** symbols whose history NSE did not give (e.g. listed on BSE only) */
    failed: failed.map((f) => f.symbol),
    /** why, when NSE itself failed (not just an unknown symbol) */
    problem: failed.find((f) => !/ 404$/.test(f.reason))?.reason ?? null,
  };
  lastFailed.set(familyId, missing);
  // NSE failing is tried again with the next prices (6 hours on), not only tomorrow
  if (missing.problem) return { ...result(fresh), ...missing };
  await prisma.fetchMark.upsert({
    where: { name: checkedMark(familyId) },
    create: { name: checkedMark(familyId), day },
    update: { day },
  });
  return { ...result(fresh), ...missing };
}

/**
 * Adds every dividend and gold bond interest not yet recorded, from NSE's history (shares held at
 * the close before each ex-date), for all the family's holdings; keeps the prices around splits
 * and mergers for the history.
 */
export function checkDividends(
  prisma: PrismaClient,
  familyId: string,
  src: Sources,
  /** after the data changed: a check already running is followed by another */
  fresh = false,
): Promise<CheckResult> {
  const start = () => {
    const run = runCheck(prisma, familyId, src)
      .catch((e: unknown) => {
        lastFailed.set(familyId, { failed: [], problem: (e as Error).message });
        throw e;
      })
      .finally(() => running.delete(familyId));
    running.set(familyId, run);
    return run;
  };
  const now = running.get(familyId);
  if (!now) return start();
  if (!fresh) return now;
  const waiting = queued.get(familyId);
  if (waiting) return waiting;
  const next = now
    .catch(() => {})
    .then(() => {
      queued.delete(familyId);
      return start();
    });
  queued.set(familyId, next);
  return next;
}

/**
 * When the family's dividends were last checked, whether a check runs now, whether the daily run
 * includes the family (NSE prices on), and what failed.
 */
export async function dividendCheckStatus(prisma: PrismaClient, familyId: string) {
  const [mark, family] = await Promise.all([
    prisma.fetchMark.findUnique({ where: { name: checkedMark(familyId) } }),
    prisma.family.findUnique({ where: { id: familyId }, select: { livePrices: true } }),
  ]);
  return {
    checkedOn: mark ? formatDay(mark.day) : null,
    running: running.has(familyId) || queued.has(familyId),
    daily: family?.livePrices ?? false,
    ...(lastFailed.get(familyId) ?? { failed: [], problem: null }),
  };
}

/** The daily run: each family with NSE prices switched on, once a day. */
export async function checkAllDividends(
  prisma: PrismaClient,
  src: Sources,
  onError: (familyId: string, err: unknown) => void = () => {},
) {
  const today = todayLocal();
  const families = await prisma.family.findMany({
    where: { livePrices: true },
    select: { id: true },
  });
  let added = 0;
  for (const f of families) {
    const mark = await prisma.fetchMark.findUnique({ where: { name: checkedMark(f.id) } });
    if (mark && formatDay(mark.day) === today) continue;
    // one family failing does not keep the others from theirs
    try {
      added += (await checkDividends(prisma, f.id, src)).added;
    } catch (err) {
      onError(f.id, err);
    }
  }
  return { added };
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
export async function corporateEvents(prisma: PrismaClient, familyId: string, src: Sources | null) {
  const today = todayLocal();
  const holdings = (await holdingsOf(prisma, familyId)).filter((h) => h.trades.some(moves));
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

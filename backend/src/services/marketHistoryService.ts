/**
 * Market history back to the first trade, for the value-over-time chart: one day a week from
 * NSE's archive (the closes of the holdings, GOLDBEES and Nifty 50) where the daily download has
 * nothing, the world gold price's history, and IBJA's 22K/24K estimated from GOLDBEES before its
 * first stored day. Splits and bonuses from NSE's history that the trades already show (they are
 * entered in today's units) are recorded on the holding first, so every past close is put in the
 * units of the trades.
 */
import type { PrismaClient } from '@prisma/client';
import { bhavcopyName, priceFor, readBhavcopy, type Bhavcopy } from '../domain/bhavcopy.js';
import { nseSymbol } from '../domain/brokerHoldings.js';
import { goldBondIssues } from '../domain/goldBonds.js';
import { estimateIndianGold } from '../domain/goldEstimate.js';
import { readGoldHistory } from '../domain/goldRates.js';
import { indexClosesName, readIndexCloses } from '../domain/indexCloses.js';
import { addDays, formatDay, parseDay, todayLocal } from '../lib/dates.js';
import { adjustedClose, INCLUDED, scale } from './corporateActionService.js';
import {
  distinct,
  isUnitChange,
  ownLot,
  refreshHistory,
  type Action,
  type Sources,
} from './corporateHistoryService.js';
import { listsUrl } from './livePriceService.js';

/** The gold ETF whose price follows the Indian gold price. */
const GOLD_PROXY = 'GOLDBEES';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const moves = (t: { type: string }) => t.type === 'buy' || t.type === 'sell';
// Days NSE has no file for (holidays): not asked again while the server runs.
const noFile = new Set<string>();

export type HistorySources = Sources & { goldHistoryUrl: string };

const unitsOn = (trades: { date: Date; type: string; units: bigint }[], day: string) =>
  trades
    .filter((t) => moves(t) && formatDay(t.date) <= day)
    .reduce((s, t) => s + (t.type === 'buy' ? Number(t.units) : -Number(t.units)), 0);

/** The daily list's splits are the app's to apply this long after their ex-date. */
const LIST_DAYS = 60;
/** Two unit changes this close are taken for one event (worded differently by list and history). */
const SAME_EVENT_DAYS = 30;
const near = (a: Date, b: Date) => Math.abs(+a - +b) <= SAME_EVENT_DAYS * 86_400_000;

/**
 * Splits and bonuses from NSE's history that the trades already show: recorded on the holding as
 * `included`, and the closes stored for days before them restated once (they were stored as NSE
 * published them; prices typed or imported are left as entered). Only past ones the daily list
 * never had (those are the app's to apply, or to leave for a check), not when the free shares are
 * a lot of their own (Paytm Money's way: the trades before are in the units of their day), and
 * never next to an action the holding already has.
 */
export async function includeKnownSplits(prisma: PrismaClient, familyIds: string[], today: string) {
  const holdings = await prisma.holding.findMany({
    where: { familyId: { in: familyIds }, archived: false, currency: 'INR', symbol: { not: null } },
    include: { trades: true, actions: true },
  });
  const symbols = [...new Set(holdings.map((h) => nseSymbol(h.symbol!)))];
  const all = await prisma.corporateAction.findMany({
    where: { symbol: { in: symbols }, kind: { in: ['split', 'bonus', 'consolidation'] } },
    orderBy: [{ exDate: 'asc' }, { purpose: 'asc' }],
  });
  const listed = all.filter((a) => a.source === 'list');
  const settled = parseDay(addDays(today, -LIST_DAYS))!;
  const actions = distinct(
    all.filter(
      (a) =>
        a.source === 'history' &&
        a.num !== null &&
        a.den !== null &&
        a.exDate <= settled &&
        !listed.some((l) => l.symbol === a.symbol && near(l.exDate, a.exDate)),
    ),
  ).filter(isUnitChange);
  let added = 0;
  for (const h of holdings) {
    const nse = nseSymbol(h.symbol!);
    for (const a of actions.filter((x) => x.symbol === nse)) {
      const ex = formatDay(a.exDate);
      if (h.actions.some((x) => near(x.exDate, a.exDate))) continue;
      const after = unitsOn(h.trades, addDays(ex, -1));
      if (after <= 0 || ownLot(h, ex)) continue;
      const { num, den } = a as { num: number; den: number };
      await prisma.$transaction(async (tx) => {
        const prices = await tx.holdingPrice.findMany({
          where: { holdingId: h.id, source: 'nse', date: { lt: a.exDate } },
        });
        for (const p of prices) {
          await tx.holdingPrice.update({
            where: { id: p.id },
            data: { price: scale(p.price, den, num) },
          });
        }
        await tx.holdingAction.create({
          data: {
            holdingId: h.id,
            exDate: a.exDate,
            purpose: a.purpose,
            kind: a.kind,
            num,
            den,
            status: 'included',
            unitsBefore: scale(BigInt(after), den, num),
            unitsAfter: BigInt(after),
          },
        });
      });
      h.actions.push({ exDate: a.exDate } as (typeof h.actions)[number]);
      added++;
    }
  }
  return added;
}

/** The Friday of a day's week (Saturday and Sunday: the one before). */
function fridayOf(day: string) {
  const w = parseDay(day)!.getUTCDay();
  return addDays(day, w === 6 ? -1 : w === 0 ? -2 : 5 - w);
}

/** The week's file: its Friday, or the day before when that was a holiday (back to Monday). */
async function weekFile(src: Sources, friday: string): Promise<Bhavcopy | null> {
  for (let d = friday; d >= addDays(friday, -4); d = addDays(d, -1)) {
    if (noFile.has(d)) continue;
    const res = await src.fetch(`${src.pricesUrl}/${bhavcopyName(d)}`);
    if (src.pauseMs) await pause(src.pauseMs);
    if (res.status === 404) {
      noFile.add(d);
      continue;
    }
    if (!res.ok) throw new Error(`NSE answered ${res.status}`);
    const file = readBhavcopy(await res.text());
    if (file.date === d) return file;
    noFile.add(d);
  }
  return null;
}

/** What a past close of a symbol not held is multiplied by: the unit changes since (until today). */
const factorAfter = (actions: Action[], symbol: string, day: string, today: string) =>
  actions
    .filter(
      (a) =>
        a.symbol === symbol &&
        a.num &&
        a.den &&
        formatDay(a.exDate) > day &&
        formatDay(a.exDate) <= today,
    )
    .reduce((f, a) => (f * a.den!) / a.num!, 1);

/** A week, by its Friday. */
const weekOf = (date: Date) => fridayOf(formatDay(date));
const weekMark = (friday: string) => `market-week:${friday}`;
/** Failing this many weeks in a row (NSE refusing a long run): the rest waits for the next run. */
const MAX_FAILURES = 3;

/**
 * One day a week, from the first trade until today, where a holding held then has no close that
 * week or GOLDBEES / Nifty 50 have no point: the week's last file from NSE's archive (the daily
 * download fills in the days of the last year later). A week is tried once — again only for a
 * holding whose trades were entered after that — so a share NSE never lists costs nothing later.
 */
export async function weeklyHistory(
  prisma: PrismaClient,
  src: Sources,
  familyIds: string[],
  today: string,
) {
  const holdings = await prisma.holding.findMany({
    where: { familyId: { in: familyIds }, archived: false, currency: 'INR', symbol: { not: null } },
    include: {
      trades: true,
      actions: { where: { status: { in: INCLUDED } } },
      prices: { select: { date: true } },
    },
  });
  const first = holdings
    .flatMap((h) => h.trades.filter(moves).map((t) => formatDay(t.date)))
    .sort()[0];
  if (!first) return { filled: 0, failed: 0 };
  // GOLDBEES's own splits, so its line has no jump (without them, its closes as published)
  await refreshHistory(prisma, src, [GOLD_PROXY], first, today);
  const proxyActions = distinct(
    await prisma.corporateAction.findMany({ where: { symbol: GOLD_PROXY } }),
  ).filter(isUnitChange);
  const formers = new Map<string, string[]>();
  for (const a of await prisma.symbolAlias.findMany()) {
    formers.set(a.symbol, [...(formers.get(a.symbol) ?? []), a.former]);
  }
  // what each week has, by its Friday
  const weeks = { gold: new Set<string>(), nifty50: new Set<string>() };
  for (const p of await prisma.benchmarkPoint.findMany({
    where: { series: { in: ['gold', 'nifty50'] }, date: { gte: parseDay(addDays(first, -7))! } },
    select: { series: true, date: true },
  })) {
    weeks[p.series as keyof typeof weeks].add(weekOf(p.date));
  }
  const pricedWeeks = new Map(
    holdings.map((h) => [h.id, new Set(h.prices.map((p) => weekOf(p.date)))]),
  );
  const tried = new Map(
    (await prisma.fetchMark.findMany({ where: { name: { startsWith: 'market-week:' } } })).map(
      (m) => [m.name, m.day],
    ),
  );
  let filled = 0;
  let failed = 0;
  let inARow = 0;
  for (let friday = fridayOf(first); friday < today; friday = addDays(friday, 7)) {
    const mark = tried.get(weekMark(friday));
    const held = holdings.filter(
      (h) =>
        unitsOn(h.trades, friday) > 0 &&
        !pricedWeeks.get(h.id)!.has(friday) &&
        // tried before: only for trades entered since
        (!mark || h.trades.some((t) => t.createdAt > mark)),
    );
    const gold = !mark && !weeks.gold.has(friday);
    const nifty = !mark && !weeks.nifty50.has(friday);
    if (held.length === 0 && !gold && !nifty) continue;
    try {
      const file = await weekFile(src, friday);
      if (file) {
        await storeWeek(prisma, src, file, { held, formers, gold, nifty, proxyActions, today });
        for (const h of held) pricedWeeks.get(h.id)!.add(friday);
        filled++;
      }
      // when it was tried: trades entered after that bring the week back
      const day = new Date();
      await prisma.fetchMark.upsert({
        where: { name: weekMark(friday) },
        create: { name: weekMark(friday), day },
        update: { day },
      });
      inARow = 0;
    } catch {
      // tried again next run
      failed++;
      if (++inARow >= MAX_FAILURES) break;
    }
  }
  return { filled, failed };
}

/** A week's closes: the holdings' (in the trades' units), GOLDBEES and Nifty 50. */
async function storeWeek(
  prisma: PrismaClient,
  src: Sources,
  file: Bhavcopy,
  w: {
    held: { id: string; symbol: string | null; actions: Parameters<typeof adjustedClose>[2] }[];
    formers: Map<string, string[]>;
    gold: boolean;
    nifty: boolean;
    proxyActions: Action[];
    today: string;
  },
) {
  const date = parseDay(file.date)!;
  for (const h of w.held) {
    const nse = nseSymbol(h.symbol!);
    let close = priceFor(file, nse);
    for (const f of w.formers.get(nse) ?? []) close ??= priceFor(file, f);
    if (close === null) continue;
    const price = adjustedClose(close, file.date, h.actions);
    await prisma.holdingPrice.upsert({
      where: { holdingId_date: { holdingId: h.id, date } },
      create: { holdingId: h.id, date, price, source: 'nse' },
      update: {},
    });
  }
  const goldbees = priceFor(file, GOLD_PROXY);
  if (w.gold && goldbees !== null) {
    const factor = factorAfter(w.proxyActions, GOLD_PROXY, file.date, w.today);
    await upsert(prisma, 'gold', date, Math.round(goldbees * factor));
  }
  if (w.nifty) {
    const res = await src.fetch(`${listsUrl(src.pricesUrl)}/${indexClosesName(file.date)}`);
    if (src.pauseMs) await pause(src.pauseMs);
    if (res.ok) {
      const closes = readIndexCloses(await res.text());
      const value = closes.date === file.date ? closes.close('Nifty 50') : null;
      if (value !== null) await upsert(prisma, 'nifty50', date, value);
    } else if (res.status !== 404) throw new Error(`NSE answered ${res.status}`);
  }
}

const upsert = (prisma: PrismaClient, series: string, date: Date, value: number) =>
  prisma.benchmarkPoint.upsert({
    where: { series_date: { series, date } },
    create: { series, date, value },
    update: { value },
  });

/**
 * The world gold price before the daily collection began, read once (from 45 days before `from`).
 * Returns the points added.
 */
export async function worldGoldHistory(
  prisma: PrismaClient,
  src: HistorySources,
  from: string,
  today: string,
) {
  const mark = await prisma.fetchMark.findUnique({ where: { name: 'gold-usd-history' } });
  // monthly averages before 2025: the month before the first trade too
  const start = addDays(from, -45);
  if (mark && formatDay(mark.day) <= start) return 0;
  const res = await src.fetch(src.goldHistoryUrl);
  if (!res.ok) throw new Error(`the gold price history answered ${res.status}`);
  const rows = readGoldHistory(await res.text());
  const firstKept = await prisma.benchmarkPoint.findFirst({
    where: { series: 'goldUsd' },
    orderBy: { date: 'asc' },
  });
  const until = firstKept ? formatDay(firstKept.date) : today;
  let added = 0;
  for (const r of rows.filter((x) => x.date >= start && x.date < until)) {
    await upsert(prisma, 'goldUsd', parseDay(r.date)!, r.usd);
    added++;
  }
  await prisma.fetchMark.upsert({
    where: { name: 'gold-usd-history' },
    create: { name: 'gold-usd-history', day: parseDay(start)! },
    update: { day: parseDay(start)! },
  });
  return added;
}

/** IBJA's 22K and 24K before its first stored day, estimated from GOLDBEES (made again each run). */
export async function storeGoldEstimates(prisma: PrismaClient) {
  const read = async (series: string) =>
    (await prisma.benchmarkPoint.findMany({ where: { series }, orderBy: { date: 'asc' } })).map(
      (p) => ({ date: formatDay(p.date), value: Number(p.value) }),
    );
  const est = estimateIndianGold({
    goldbees: await read('gold'),
    k24: await read('gold24k'),
    k22: await read('gold22k'),
    anchors: goldBondIssues().map((g) => ({ date: g.date, value: g.price * 1_000_000 })),
  });
  const rows = (series: string, list: { date: string; value: number }[]) =>
    list.map((p) => ({ series, date: parseDay(p.date)!, value: Math.round(p.value) }));
  await prisma.$transaction([
    prisma.benchmarkPoint.deleteMany({ where: { series: { in: ['gold24kEst', 'gold22kEst'] } } }),
    prisma.benchmarkPoint.createMany({
      data: [...rows('gold24kEst', est.k24), ...rows('gold22kEst', est.k22)],
    }),
  ]);
  return est.k24.length;
}

/**
 * Everything above, for the families with NSE prices on (after the daily dividend check, which
 * looks up the splits). Each step on its own: one failing does not keep the others from running.
 */
export async function backfillHistory(
  prisma: PrismaClient,
  src: HistorySources,
  today = todayLocal(),
) {
  const done = { weeks: 0, worldGold: 0, estimated: 0, errors: [] as string[] };
  const families = await prisma.family.findMany({
    where: { livePrices: true },
    select: { id: true },
  });
  if (families.length === 0) return done;
  const ids = families.map((f) => f.id);
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      done.errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  await step('splits', async () => void (await includeKnownSplits(prisma, ids, today)));
  await step('weeks', async () => {
    const w = await weeklyHistory(prisma, src, ids, today);
    done.weeks = w.filled;
    if (w.failed) done.errors.push(`weeks: ${w.failed} could not be downloaded`);
  });
  await step('world gold', async () => {
    const first = await prisma.holdingTrade.findFirst({
      where: { holding: { familyId: { in: ids } }, type: { in: ['buy', 'sell'] } },
      orderBy: { date: 'asc' },
    });
    if (first) done.worldGold = await worldGoldHistory(prisma, src, formatDay(first.date), today);
  });
  await step('gold estimates', async () => {
    done.estimated = await storeGoldEstimates(prisma);
  });
  return done;
}

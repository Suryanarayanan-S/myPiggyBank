import type { PrismaClient } from '@prisma/client';
import { indexClosesName, readIndexCloses } from '../domain/indexCloses.js';
import { readGoldApi, readIbja } from '../domain/goldRates.js';
import { bhavcopyName, priceFor, readBhavcopy, type Bhavcopy } from '../domain/bhavcopy.js';
import {
  INDEX_LISTS,
  classify,
  readIndexList,
  type IndexList,
  type Listed,
} from '../domain/indexLists.js';
import { addDays, formatDay, parseDay } from '../lib/dates.js';

/** The slice of `fetch` the price download needs (injected so tests never touch the network). */
export type FetchText = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** NSE's public archive of end-of-day files: free, no login, published each trading evening. */
export const DEFAULT_PRICES_URL = 'https://nsearchives.nseindia.com/products/content';
/** Indian gold rates (IBJA) and the world gold price in US dollars per ounce. */
export const DEFAULT_GOLD_SOURCES = {
  ibja: 'https://ibjarates.com/',
  usd: 'https://api.gold-api.com/price/XAU',
};
export type GoldSources = typeof DEFAULT_GOLD_SOURCES;
/** Weekends and holidays: look back this many days for the latest published file. */
const LOOKBACK_DAYS = 7;

export type LivePriceStatus = {
  /** trading day of the latest downloaded closes, YYYY-MM-DD */
  asOf: string | null;
  fetchedAt: string | null;
  /** holdings given that day's close in the last run */
  updated: number;
  /** symbols NSE does not list (e.g. BSE-only shares): they keep their last price */
  notFound: string[];
  lastError: string | null;
  /** The prices were saved, but something on the side (sector lists) was not. */
  warning: string | null;
};

// One server process, so the last outcome can live in memory (per family: symbols are private).
type Outcome = { asOf: string; fetchedAt: string; updated: number; notFound: string[] };
const outcomes = new Map<string, Outcome>();
let lastError: string | null = null;
let warning: string | null = null;
let lastFile: string | null = null;
// The last file read, so the same day is downloaded once (NSE does not change a published file).
let cached: Bhavcopy | null = null;
/** For tests: forget what was downloaded and what the runs did. */
export function forgetLivePrices() {
  cached = null;
  noFile.clear();
  noIndex.clear();
  lastFile = null;
  lastError = null;
  warning = null;
  outcomes.clear();
}

export function livePriceStatus(familyId?: string): LivePriceStatus {
  const all = [...outcomes.values()];
  const o = familyId ? outcomes.get(familyId) : undefined;
  return {
    asOf: familyId ? (o?.asOf ?? null) : lastFile,
    fetchedAt: familyId ? (o?.fetchedAt ?? null) : (all[0]?.fetchedAt ?? null),
    updated: familyId ? (o?.updated ?? 0) : all.reduce((s, x) => s + x.updated, 0),
    notFound: familyId ? (o?.notFound ?? []) : [...new Set(all.flatMap((x) => x.notFound))],
    lastError,
    warning,
  };
}

/** NSE keeps the index lists next to the daily files: …/products/content → …/content/indices. */
const listsUrl = (base: string) =>
  base.endsWith('/products/content')
    ? `${base.slice(0, -'/products/content'.length)}/content/indices`
    : `${base}/indices`;
/** Industries and size groups change slowly (index reviews are half-yearly): refresh monthly. */
const INFO_DAYS = 30;

/** Each listed company's industry and SEBI size group, from NSE's index lists. */
async function refreshInstruments(
  prisma: PrismaClient,
  fetchText: FetchText,
  baseUrl: string,
  today: string,
) {
  const newest = await prisma.instrumentInfo.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (newest && newest.updatedAt >= parseDay(addDays(today, -INFO_DAYS))!) return;
  const files = {} as Record<IndexList, Listed[]>;
  for (const [list, name] of Object.entries(INDEX_LISTS) as [IndexList, string][]) {
    const res = await fetchText(`${listsUrl(baseUrl)}/${name}`);
    if (!res.ok) throw new Error(`NSE answered ${res.status} for its index lists`);
    files[list] = readIndexList(await res.text());
  }
  const rows = classify(files);
  if (rows.length === 0) throw new Error('NSE sent empty index lists');
  await prisma.$transaction([
    prisma.instrumentInfo.deleteMany(),
    // Dated by the run's day (not the clock), like everything else here.
    prisma.instrumentInfo.createMany({
      data: rows.map((r) => ({ ...r, updatedAt: parseDay(today)! })),
    }),
  ]);
}

/** The newest published file on or before `today`. */
async function latestFile(fetchText: FetchText, baseUrl: string, today: string): Promise<Bhavcopy> {
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    const day = addDays(today, -i);
    if (cached?.date === day) return cached;
    const res = await fetchText(`${baseUrl}/${bhavcopyName(day)}`);
    if (res.ok) {
      const file = readBhavcopy(await res.text());
      // A file that is not the day asked for is not that day's prices.
      if (file.date !== day) continue;
      cached = file;
      return file;
    }
    if (res.status !== 404) throw new Error(`NSE answered ${res.status}`);
  }
  throw new Error(`NSE has no price file for the last ${LOOKBACK_DAYS} days`);
}

/**
 * Gives every open rupee holding of the families that want it the latest NSE closing price.
 * A price typed by hand on that day is kept; imported and downloaded ones are replaced.
 * Nothing is downloaded when no family has switched it on. Prices are kept on any failure.
 */
export function refreshLivePrices(
  prisma: PrismaClient,
  fetchText: FetchText,
  today: string,
  baseUrl = DEFAULT_PRICES_URL,
  familyId?: string,
  gold: GoldSources = DEFAULT_GOLD_SOURCES,
): Promise<LivePriceStatus> {
  // The 6-hour timer and "Update now" can overlap: they share one run.
  const start = () =>
    (running ??= run(prisma, fetchText, today, baseUrl, gold).finally(() => {
      running = null;
    }));
  const joined = running !== null;
  return start().then(async () => {
    // A family that switched on while a run was under way was not in it: run once more.
    if (joined && familyId && !outcomes.has(familyId)) await start();
    return livePriceStatus(familyId);
  });
}
let running: Promise<void> | null = null;

async function run(
  prisma: PrismaClient,
  fetchText: FetchText,
  today: string,
  baseUrl: string,
  gold: GoldSources,
) {
  const families = await prisma.family
    .findMany({ where: { livePrices: true }, select: { id: true } })
    .catch(() => null);
  if (!families) return;
  if (families.length === 0) {
    outcomes.clear();
    return;
  }
  const familyIds = families.map((f) => f.id);
  // The steps on the side: each failure is said (prices are saved either way).
  const warnings: string[] = [];
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  try {
    const file = await latestFile(fetchText, baseUrl, today);
    // A run covers every family that wants prices: older outcomes (or switched-off families) go,
    // but only once there is a new file (a failed run keeps showing the last good one).
    outcomes.clear();
    const fetchedAt = new Date().toISOString();
    for (const id of familyIds)
      outcomes.set(id, { asOf: file.date, fetchedAt, updated: 0, notFound: [] });
    await applyDay(prisma, file, familyIds, outcomes);
    lastFile = file.date;
    lastError = null;
    // Nifty 50 and GOLDBEES for comparison, then the days since the first trade that are missing.
    try {
      await storeBenchmarks(prisma, fetchText, baseUrl, file);
      await backfill(prisma, fetchText, baseUrl, file, familyIds);
    } catch (err) {
      warnings.push(`Comparison with Nifty 50 not updated: ${message(err)}.`);
    }
    // Sectors and size groups: a failure here keeps the old ones.
    try {
      await refreshInstruments(prisma, fetchText, baseUrl, today);
    } catch (err) {
      warnings.push(`Sectors and size groups were not updated: ${message(err)}.`);
    }
  } catch (err) {
    lastError = message(err);
  }
  // Gold does not depend on NSE: the Indian 22K / 24K rates and the world price per ounce.
  try {
    await storeIbja(prisma, fetchText, gold.ibja, today);
  } catch (err) {
    warnings.push(`Indian gold rates (IBJA) not updated: ${message(err)}.`);
  }
  try {
    await storeGoldUsd(prisma, fetchText, gold.usd, today);
  } catch (err) {
    warnings.push(`World gold price not updated: ${message(err)}.`);
  }
  warning = warnings.length ? warnings.join(' ') : null;
}

/**
 * A day's closing prices for the open rupee holdings of these families (as held that day). A
 * price typed by hand that day is kept. With `outcomes`, what happened is counted per family.
 */
async function applyDay(
  prisma: PrismaClient,
  file: Bhavcopy,
  familyIds: string[],
  outcomes?: Map<string, Outcome>,
) {
  const date = parseDay(file.date)!;
  const holdings = await prisma.holding.findMany({
    where: { familyId: { in: familyIds }, archived: false, currency: 'INR', symbol: { not: null } },
    // Trades dated after the file's day do not change what was held that day.
    include: { trades: { where: { date: { lte: date } } }, prices: { where: { date } } },
  });
  for (const h of holdings) {
    const units = h.trades.reduce(
      (s, t) => s + (t.type === 'buy' ? Number(t.units) : t.type === 'sell' ? -Number(t.units) : 0),
      0,
    );
    if (units <= 0) continue;
    const outcome = outcomes?.get(h.familyId);
    const price = priceFor(file, h.symbol!);
    if (price === null) {
      if (outcome && !outcome.notFound.includes(h.symbol!)) outcome.notFound.push(h.symbol!);
      continue;
    }
    if (h.prices.some((p) => p.source === 'manual')) continue;
    await prisma.holdingPrice.upsert({
      where: { holdingId_date: { holdingId: h.id, date } },
      create: { holdingId: h.id, date, price, source: 'nse' },
      update: { price, source: 'nse' },
    });
    if (outcome) outcome.updated++;
  }
}

/** The gold ETF whose price follows the Indian gold price. */
const GOLD_PROXY = 'GOLDBEES';

/** Nifty 50 (from the day's index closes) and gold (GOLDBEES) for the day of `file`. */
async function storeBenchmarks(
  prisma: PrismaClient,
  fetchText: FetchText,
  baseUrl: string,
  file: Bhavcopy,
) {
  const date = parseDay(file.date)!;
  const points: { series: string; value: number }[] = [];
  const gold = priceFor(file, GOLD_PROXY);
  if (gold !== null) points.push({ series: 'gold', value: gold });
  // A day's index close never changes: asked until known (or until NSE says it has none).
  const known = await prisma.benchmarkPoint.findUnique({
    where: { series_date: { series: 'nifty50', date } },
  });
  if (!known && !noIndex.has(file.date)) {
    const res = await fetchText(`${listsUrl(baseUrl)}/${indexClosesName(file.date)}`);
    if (res.ok) {
      const closes = readIndexCloses(await res.text());
      const nifty = closes.date === file.date ? closes.close('Nifty 50') : null;
      if (nifty !== null) points.push({ series: 'nifty50', value: nifty });
      else noIndex.add(file.date);
    } else if (res.status === 404) noIndex.add(file.date);
    else throw new Error(`NSE answered ${res.status} for its index closes`);
  }
  for (const p of points) {
    await prisma.benchmarkPoint.upsert({
      where: { series_date: { series: p.series, date } },
      create: { series: p.series, date, value: p.value },
      update: { value: p.value },
    });
  }
}

/** How far back, and how many past days per run (one file each: be gentle with NSE). */
const BACKFILL_MAX_DAYS = 366;
const BACKFILL_PER_RUN = 10;
// Days NSE has no price file / no index close for (holidays): not asked again while the server
// runs (after a restart they are asked once more — a handful of requests a year).
const noFile = new Set<string>();
const noIndex = new Set<string>();

type Trade = { date: Date; type: string; units: bigint };
/** Units held at the end of a day. */
const unitsOn = (trades: Trade[], day: string) =>
  trades
    .filter((t) => formatDay(t.date) <= day)
    .reduce(
      (s, t) => s + (t.type === 'buy' ? Number(t.units) : t.type === 'sell' ? -Number(t.units) : 0),
      0,
    );

/**
 * Past trading days that are still missing something — a gold or Nifty 50 point, or the close
 * of a holding held that day — since the first trade of a holding that is still held and listed
 * on NSE (sold-out holdings and ones without a symbol do not reach back). Oldest first.
 */
async function backfill(
  prisma: PrismaClient,
  fetchText: FetchText,
  baseUrl: string,
  latest: Bhavcopy,
  familyIds: string[],
) {
  const holdings = await prisma.holding.findMany({
    where: { familyId: { in: familyIds }, currency: 'INR', archived: false, symbol: { not: null } },
    include: { trades: true, prices: { select: { date: true } } },
  });
  // Held now and listed on NSE: others never get a close, so there is no point asking for them.
  const open = holdings
    .filter((h) => unitsOn(h.trades, latest.date) > 0 && priceFor(latest, h.symbol!) !== null)
    .map((h) => ({ trades: h.trades, priced: new Set(h.prices.map((p) => formatDay(p.date))) }));
  if (open.length === 0) return;
  const first = open.flatMap((h) => h.trades.map((t) => formatDay(t.date))).sort()[0]!;
  const floor = addDays(latest.date, -BACKFILL_MAX_DAYS);
  let day = first < floor ? floor : first;
  const points = new Set(
    (
      await prisma.benchmarkPoint.findMany({
        where: { date: { gte: parseDay(day)! } },
        select: { series: true, date: true },
      })
    ).map((p) => `${p.series}|${formatDay(p.date)}`),
  );
  const missing = (d: string) =>
    !points.has(`gold|${d}`) ||
    (!points.has(`nifty50|${d}`) && !noIndex.has(d)) ||
    open.some((h) => !h.priced.has(d) && unitsOn(h.trades, d) > 0);
  let asked = 0;
  for (; day < latest.date && asked < BACKFILL_PER_RUN; day = addDays(day, 1)) {
    const weekday = parseDay(day)!.getUTCDay();
    if (weekday === 0 || weekday === 6 || noFile.has(day) || !missing(day)) continue;
    asked++;
    const res = await fetchText(`${baseUrl}/${bhavcopyName(day)}`);
    if (res.status === 404) {
      noFile.add(day);
      continue;
    }
    if (!res.ok) throw new Error(`NSE answered ${res.status}`);
    const file = readBhavcopy(await res.text());
    // A file that is not that day's, or without a gold close, is not asked again either.
    if (file.date !== day || priceFor(file, GOLD_PROXY) === null) {
      noFile.add(day);
      continue;
    }
    await applyDay(prisma, file, familyIds);
    await storeBenchmarks(prisma, fetchText, baseUrl, file);
    // What could be had of this day is in: not asked again while the server runs.
    noFile.add(day);
  }
}

async function upsertPoint(prisma: PrismaClient, series: string, day: string, value: number) {
  const date = parseDay(day)!;
  await prisma.benchmarkPoint.upsert({
    where: { series_date: { series, date } },
    create: { series, date, value },
    update: { value },
  });
}

/** IBJA's last few days of 22K and 24K rates per gram (one page, every run). */
async function storeIbja(prisma: PrismaClient, fetchText: FetchText, url: string, today: string) {
  const res = await fetchText(url);
  if (!res.ok) throw new Error(`IBJA answered ${res.status}`);
  for (const r of readIbja(await res.text(), today)) {
    await upsertPoint(prisma, 'gold22k', r.date, r.k22);
    await upsertPoint(prisma, 'gold24k', r.date, r.k24);
  }
}

/**
 * The world gold price now, as today's point (the day's last run leaves its value). Markets are
 * closed at weekends: nothing is stored then, so the chart has no rows for weekend days.
 */
async function storeGoldUsd(
  prisma: PrismaClient,
  fetchText: FetchText,
  url: string,
  today: string,
) {
  const weekday = parseDay(today)!.getUTCDay();
  if (weekday === 0 || weekday === 6) return;
  const res = await fetchText(url);
  if (!res.ok) throw new Error(`the service answered ${res.status}`);
  const p = readGoldApi(await res.text());
  await upsertPoint(prisma, 'goldUsd', today, p.usd);
}

/** Nifty 50 and gold since a day, for the comparison chart (values as plain numbers). */
export async function benchmarks(prisma: PrismaClient, from?: string) {
  const rows = await prisma.benchmarkPoint.findMany({
    where: from ? { date: { gte: parseDay(from)! } } : {},
    orderBy: { date: 'asc' },
  });
  const series = (name: string) =>
    rows
      .filter((r) => r.series === name)
      .map((r) => ({ date: formatDay(r.date), value: Number(r.value) / 1_000_000 }));
  return {
    nifty50: series('nifty50'),
    /** GOLDBEES (₹ per unit) */
    gold: series('gold'),
    /** IBJA, ₹ per gram */
    gold22k: series('gold22k'),
    gold24k: series('gold24k'),
    /** US dollars per troy ounce */
    goldUsd: series('goldUsd'),
  };
}

/** Whether any family wants NSE prices (the server only downloads when one does). */
export async function livePricesWanted(prisma: PrismaClient) {
  return (await prisma.family.count({ where: { livePrices: true } })) > 0;
}

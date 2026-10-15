import type { PrismaClient } from '@prisma/client';
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
): Promise<LivePriceStatus> {
  // The 6-hour timer and "Update now" can overlap: they share one run.
  const start = () =>
    (running ??= run(prisma, fetchText, today, baseUrl).finally(() => {
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

async function run(prisma: PrismaClient, fetchText: FetchText, today: string, baseUrl: string) {
  try {
    const families = await prisma.family.findMany({
      where: { livePrices: true },
      select: { id: true },
    });
    if (families.length === 0) {
      outcomes.clear();
      return;
    }
    const file = await latestFile(fetchText, baseUrl, today);
    // A run covers every family that wants prices: older outcomes (or switched-off families) go,
    // but only once there is a new file (a failed run keeps showing the last good one).
    outcomes.clear();
    const date = parseDay(file.date)!;
    const holdings = await prisma.holding.findMany({
      where: {
        familyId: { in: families.map((f) => f.id) },
        archived: false,
        currency: 'INR',
        symbol: { not: null },
      },
      // Trades dated after the file's day do not change what was held that day.
      include: { trades: { where: { date: { lte: date } } }, prices: { where: { date } } },
    });
    const fetchedAt = new Date().toISOString();
    for (const f of families)
      outcomes.set(f.id, { asOf: file.date, fetchedAt, updated: 0, notFound: [] });
    for (const h of holdings) {
      const units = h.trades.reduce(
        (s, t) =>
          s + (t.type === 'buy' ? Number(t.units) : t.type === 'sell' ? -Number(t.units) : 0),
        0,
      );
      if (units <= 0) continue;
      const outcome = outcomes.get(h.familyId)!;
      const price = priceFor(file, h.symbol!);
      if (price === null) {
        if (!outcome.notFound.includes(h.symbol!)) outcome.notFound.push(h.symbol!);
        continue;
      }
      if (h.prices.some((p) => p.source === 'manual')) continue;
      await prisma.holdingPrice.upsert({
        where: { holdingId_date: { holdingId: h.id, date } },
        create: { holdingId: h.id, date, price, source: 'nse' },
        update: { price, source: 'nse' },
      });
      outcome.updated++;
    }
    lastFile = formatDay(date);
    lastError = null;
    // Sectors and size groups: a failure here keeps the old ones and does not undo the prices.
    try {
      await refreshInstruments(prisma, fetchText, baseUrl, today);
      warning = null;
    } catch (err) {
      warning = `Sectors and size groups were not updated: ${err instanceof Error ? err.message : String(err)}`;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
}

/** Whether any family wants NSE prices (the server only downloads when one does). */
export async function livePricesWanted(prisma: PrismaClient) {
  return (await prisma.family.count({ where: { livePrices: true } })) > 0;
}

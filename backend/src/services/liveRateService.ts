import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CURRENCIES } from '../domain/currency.js';
import { addDays } from '../lib/dates.js';

/** The slice of `fetch` the rate download needs (injected so tests never touch the network). */
export type FetchRates = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Frankfurter serves the ECB reference rates: free, no key, updated each working day. */
export const DEFAULT_RATES_URL = 'https://api.frankfurter.dev/v1';
const SYMBOLS = CURRENCIES.filter((c) => c !== 'EUR');
/** Never backfill further than this, whatever the oldest transaction says. */
const MAX_BACKFILL_MONTHS = 120;

const Answer = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive().finite()),
});

export type LiveStatus = {
  asOf: string | null;
  fetchedAt: string | null;
  lastError: string | null;
};
// One server process, so the last outcome can live in memory.
let lastError: string | null = null;

export async function liveStatus(prisma: PrismaClient): Promise<LiveStatus> {
  const latest = await prisma.liveRate.findFirst({
    orderBy: [{ asOf: 'desc' }, { updatedAt: 'desc' }],
  });
  return {
    asOf: latest?.asOf ?? null,
    fetchedAt: latest?.updatedAt.toISOString() ?? null,
    lastError,
  };
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

async function download(fetchRates: FetchRates, baseUrl: string, day: string) {
  const res = await fetchRates(`${baseUrl}/${day}?base=EUR&symbols=${SYMBOLS.join(',')}`);
  if (!res.ok) throw new Error(`Rate service answered ${res.status}`);
  const parsed = Answer.safeParse(await res.json());
  if (!parsed.success || Object.keys(parsed.data.rates).length === 0) {
    throw new Error('Rate service gave an unexpected answer');
  }
  return parsed.data;
}

async function store(
  prisma: PrismaClient,
  month: string,
  answer: z.output<typeof Answer>,
  final: boolean,
) {
  const rows = Object.entries(answer.rates)
    .filter(([quote]) => (SYMBOLS as readonly string[]).includes(quote))
    .map(([quote, rate]) => ({ quote, rateMicros: Math.round(rate * 1_000_000) }));
  // A rate that rounds to 0 (or is absurdly large) would break every conversion: refuse it all.
  if (rows.some((r) => r.rateMicros < 1 || r.rateMicros > 2_000_000_000)) {
    throw new Error('Rate service gave an unexpected answer');
  }
  await prisma.$transaction(
    rows.map(({ quote, rateMicros }) =>
      prisma.liveRate.upsert({
        where: { month_quote: { month, quote } },
        create: { month, quote, rateMicros, asOf: answer.date, final },
        update: { rateMicros, asOf: answer.date, final },
      }),
    ),
  );
}

/**
 * Downloads month-end rates for every finished month since the first transaction that is not
 * stored yet, then the latest rate for the current month. Old rates are kept on any failure.
 */
export function refreshLiveRates(
  prisma: PrismaClient,
  fetchRates: FetchRates,
  today: string,
  baseUrl = DEFAULT_RATES_URL,
): Promise<LiveStatus> {
  // Startup, the 6-hour timer and "Update now" can overlap: they share one run.
  running ??= runRefresh(prisma, fetchRates, today, baseUrl).finally(() => {
    running = null;
  });
  return running;
}
let running: Promise<LiveStatus> | null = null;

/** The provider may not have the last day of a month yet right after it; wait a few days. */
const settled = (month: string, today: string) => today >= addDays(lastDayOf(month), 3);

async function runRefresh(
  prisma: PrismaClient,
  fetchRates: FetchRates,
  today: string,
  baseUrl: string,
): Promise<LiveStatus> {
  const current = today.slice(0, 7);
  try {
    const first = await prisma.transaction.findFirst({
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    // A finished month is done once it has a final rate for every currency (a partial answer
    // is asked again next time).
    const finals = await prisma.liveRate.groupBy({
      by: ['month'],
      where: { final: true, quote: { in: [...SYMBOLS] } },
      _count: { quote: true },
    });
    const done = new Set(
      finals.filter((f) => f._count.quote >= SYMBOLS.length).map((f) => f.month),
    );
    const oldest = addMonths(current, -MAX_BACKFILL_MONTHS);
    let month = first ? first.date.toISOString().slice(0, 7) : current;
    if (month < oldest) month = oldest;
    for (; month < current; month = addMonths(month, 1)) {
      if (done.has(month)) continue;
      const answer = await download(fetchRates, baseUrl, lastDayOf(month));
      await store(prisma, month, answer, settled(month, today));
    }
    const latest = await download(fetchRates, baseUrl, 'latest');
    // Early in a month the latest ECB day can still be in the previous month: that is its end rate.
    const latestMonth = latest.date.slice(0, 7);
    await store(prisma, latestMonth, latest, latestMonth < current && settled(latestMonth, today));
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }
  return liveStatus(prisma);
}

/** Whether any family uses live rates (the server only downloads when one does). */
export async function liveRatesWanted(prisma: PrismaClient) {
  return (await prisma.family.count({ where: { rateMode: 'live' } })) > 0;
}

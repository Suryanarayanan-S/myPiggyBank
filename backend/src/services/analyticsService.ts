import type { PrismaClient } from '@prisma/client';
import { FX_CURRENCIES, compareTransfer, fxSeries, type FxCurrency } from '../domain/fx.js';
import { readCurrencyQuote } from '../domain/onvista.js';
import { formatDay } from '../lib/dates.js';
import type { FetchText } from './livePriceService.js';
import { refreshEcbRates } from './worldPriceService.js';

const MARK = 'ecb-rates';
/** the page asks the ECB again after this long (it publishes once a working day) */
const REFRESH_MS = 60 * 60_000;
const isFx = (c: string): c is FxCurrency => (FX_CURRENCIES as string[]).includes(c);

// what the last attempt said (kept until one succeeds), and the attempt under way
let lastError: string | null = null;
let running: Promise<void> | null = null;

/**
 * Asks the ECB for new rates when the last ask is over an hour old (one ask at a time); what
 * went wrong, if the last ask failed — said on every view until an ask succeeds.
 */
async function refreshIfStale(
  prisma: PrismaClient,
  online: { fetchText: FetchText; ecbUrl: string },
  today: string,
): Promise<string | null> {
  const mark = await prisma.fetchMark.findUnique({ where: { name: MARK } });
  if (running || (mark && Date.now() - mark.day.getTime() < REFRESH_MS)) {
    await running;
    return lastError;
  }
  running = (async () => {
    await prisma.fetchMark.upsert({
      where: { name: MARK },
      create: { name: MARK, day: new Date() },
      update: { day: new Date() },
    });
    try {
      await refreshEcbRates(prisma, online.fetchText, online.ecbUrl, today);
      lastError = null;
    } catch (err) {
      lastError = `The ECB could not be reached (${err instanceof Error ? err.message : String(err)}); the rates shown are the last ones kept.`;
    }
  })().finally(() => (running = null));
  await running;
  return lastError;
}

/** For tests: forget the last attempt and the quotes kept. */
export function forgetEcbAttempts() {
  lastError = null;
  live = null;
}

/** The pairs quoted during the day, as onvista names them. */
const LIVE_PAIRS = ['EURINR', 'USDINR', 'EURUSD'] as const;
/**
 * quotes are asked for again after this long (they come about a quarter of an hour late); a
 * little under the page's five minutes, so each look of the page gets new ones; a failed ask is
 * tried again sooner
 */
const LIVE_MS = 4.5 * 60_000;
const LIVE_FAILED_MS = 60_000;
type LiveQuotes = {
  quotes: { pair: (typeof LIVE_PAIRS)[number]; rate: number; at: string }[];
  error: string | null;
};
let live: { at: number; result: Promise<LiveQuotes>; failed?: boolean } | null = null;

/**
 * The three pairs during the day: onvista's quotes (FactSet, delayed by about 15 minutes), asked
 * for at most every five minutes whoever looks. The ECB's daily rates stay the reference for the
 * history and the transfers; these only show where the day is going.
 */
export function liveQuotes(online: { fetchText: FetchText; onvistaUrl: string } | null) {
  if (!online) return Promise.resolve<LiveQuotes>({ quotes: [], error: null });
  if (live && Date.now() - live.at < (live.failed ? LIVE_FAILED_MS : LIVE_MS)) return live.result;
  const result = (async (): Promise<LiveQuotes> => {
    // the three at once: a dead connection waits for one timeout, not three
    const got = await Promise.all(
      LIVE_PAIRS.map(async (pair) => {
        try {
          const res = await online.fetchText(
            `${online.onvistaUrl}/instruments/CURRENCY/${pair}/snapshot`,
          );
          const q = res.ok ? readCurrencyQuote(await res.text()) : null;
          return q ? { pair, ...q } : pair;
        } catch {
          return pair;
        }
      }),
    );
    const quotes = got.filter((g) => typeof g !== 'string');
    const failed = got.filter((g) => typeof g === 'string');
    if (live && failed.length) live.failed = true;
    return {
      quotes,
      error: failed.length
        ? `onvista did not quote ${failed.join(', ')} just now: the daily ECB rates are shown.`
        : null,
    };
  })();
  live = { at: Date.now(), result };
  return result;
}

/**
 * Euro, dollar and rupee: the ECB's daily rates since 2020 (fresh at most an hour after the ECB
 * publishes, when this is opened), and the family's transfers between two of these currencies
 * against the market rate of their day.
 */
export async function currencyAnalytics(
  prisma: PrismaClient,
  familyId: string,
  online: { fetchText: FetchText; ecbUrl: string } | null,
  today: string,
) {
  const refreshError = online ? await refreshIfStale(prisma, online, today) : null;
  const points = await prisma.benchmarkPoint.findMany({
    where: { series: { in: ['usdPerEur', 'inrPerEur'] } },
    orderBy: { date: 'asc' },
  });
  const of = (series: string) =>
    points
      .filter((p) => p.series === series)
      .map((p) => ({ date: formatDay(p.date), value: Number(p.value) / 1_000_000 }));
  const series = fxSeries(of('usdPerEur'), of('inrPerEur'));

  const moves = await prisma.transaction.findMany({
    where: { familyId, type: 'transfer', transferAmount: { not: null } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      date: true,
      amount: true,
      transferAmount: true,
      account: { select: { name: true, currency: true } },
      transferAccount: { select: { name: true, currency: true } },
    },
  });
  let uncompared = 0;
  const transfers = moves.flatMap((t) => {
    const from = t.account?.currency ?? '';
    const to = t.transferAccount?.currency ?? '';
    if (!isFx(from) || !isFx(to) || from === to) return [];
    const move = {
      date: formatDay(t.date),
      from,
      to,
      sent: Number(t.amount),
      received: Number(t.transferAmount),
    };
    const vs = compareTransfer(move, series);
    // before the first rate kept (2020): counted, not compared
    if (!vs) uncompared += 1;
    return vs
      ? [
          {
            id: t.id,
            ...move,
            fromAccount: t.account!.name,
            toAccount: t.transferAccount!.name,
            ...vs,
          },
        ]
      : [];
  });
  return { asOf: series.at(-1)?.date ?? null, series, transfers, uncompared, refreshError };
}

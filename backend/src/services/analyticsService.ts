import type { PrismaClient } from '@prisma/client';
import { FX_CURRENCIES, compareTransfer, fxSeries, type FxCurrency } from '../domain/fx.js';
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

/** For tests: forget the last attempt. */
export function forgetEcbAttempts() {
  lastError = null;
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

/**
 * Shares and funds outside India (bought through a broker such as Trade Republic, held under
 * their ISIN): their daily closes and splits from onvista, and the euro markets to compare them
 * with — ETFs bought in euros, and gold in euros (the world price ÷ the ECB's dollar rate).
 * Only for families that switched daily prices on; prices typed by hand are never replaced, and
 * anything that fails is said and kept as it was.
 */
import type { PrismaClient } from '@prisma/client';
import {
  readEod,
  readSearch,
  readSnapshot,
  splitRatio,
  type OnvistaSplit,
} from '../domain/onvista.js';
import { addDays, formatDay, parseDay } from '../lib/dates.js';
import { scale } from './corporateActionService.js';
import type { FetchText } from './livePriceService.js';

export const DEFAULT_WORLD_SOURCES = {
  onvista: 'https://api.onvista.de/api/v1',
  /** the ECB's reference rates (free, official) */
  ecb: 'https://data-api.ecb.europa.eu/service/data/EXR',
};
export type WorldSources = typeof DEFAULT_WORLD_SOURCES;

/** What euro investments are compared with: ETFs bought in euros, from 2020. */
export const WORLD_BENCHMARKS = [
  { series: 'msciWorld', isin: 'IE00B4L5Y983' },
  { series: 'sp500', isin: 'IE00B5BMR087' },
  { series: 'nasdaq100', isin: 'IE00B53SZB19' },
  { series: 'stoxx600', isin: 'DE0002635307' },
  { series: 'nikkei225', isin: 'LU0839027447' },
] as const;
const HISTORY_FROM = '2020-01-01';
/** Where an ISIN is quoted changes rarely: looked up again after this many days. */
const RESOLVE_DAYS = 30;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export type WorldStatus = {
  fetchedAt: string | null;
  /** holdings that got closes in the last run */
  updated: number;
  /** ISINs onvista does not quote in the holding's currency: they keep their last price */
  notFound: string[];
  lastError: string | null;
};
type Outcome = { fetchedAt: string; updated: number; notFound: string[]; errors: string[] };
// per family: a holding's name never shows in another family's status
const outcomes = new Map<string, Outcome>();
/** the markets' steps (public data): the same for every family */
let lastError: string | null = null;
export function forgetWorldPrices() {
  outcomes.clear();
  lastError = null;
}
export function worldStatus(familyId: string): WorldStatus {
  const o = outcomes.get(familyId);
  return {
    fetchedAt: o?.fetchedAt ?? null,
    updated: o?.updated ?? 0,
    notFound: o?.notFound ?? [],
    lastError: [...(o?.errors ?? []), ...(lastError ? [lastError] : [])].join(' ') || null,
  };
}

type Ctx = {
  prisma: PrismaClient;
  fetchText: FetchText;
  src: WorldSources;
  pauseMs: number;
  /** ISINs looked up again in this run (after a jump): once is enough */
  rechecked: Set<string>;
};

async function get(ctx: Ctx, url: string) {
  if (ctx.pauseMs) await new Promise((r) => setTimeout(r, ctx.pauseMs));
  const res = await ctx.fetchText(url);
  if (!res.ok) throw new Error(`onvista answered ${res.status}`);
  return res.text();
}

/** Where onvista quotes an ISIN in `currency` (cached), or null when it does not. */
async function resolve(ctx: Ctx, isin: string, currency: string, today: string, force = false) {
  const known = await ctx.prisma.worldInstrument.findUnique({ where: { isin } });
  const fresh =
    !force &&
    known &&
    known.currency === currency &&
    formatDay(known.updatedAt) >= addDays(today, -RESOLVE_DAYS);
  if (fresh) return known;
  const found = readSearch(
    await get(ctx, `${ctx.src.onvista}/instruments/search/facet?searchValue=${isin}`),
    isin,
  );
  if (!found) return null;
  const snap = readSnapshot(
    await get(ctx, `${ctx.src.onvista}/instruments/${found.entityType}/ISIN:${isin}/snapshot`),
    currency,
  );
  const data = {
    entityType: found.entityType,
    entityValue: found.entityValue,
    name: found.name,
    idNotation: snap.quote?.idNotation ?? null,
    venue: snap.quote?.venue ?? null,
    currency,
    splits: JSON.stringify(snap.splits),
  };
  return ctx.prisma.worldInstrument.upsert({
    where: { isin },
    create: { isin, ...data },
    update: data,
  });
}

/**
 * Daily closes from `from` up to the day before `today`, oldest first (onvista hands out five
 * years a call). Today's is left for tomorrow: during the session it is the price of the moment.
 */
async function closes(
  ctx: Ctx,
  inst: { entityType: string; entityValue: string; idNotation: string },
  from: string,
  today: string,
) {
  const out: { date: string; close: number }[] = [];
  let start = from;
  for (let i = 0; i < 3 && start <= today; i++) {
    const page = readEod(
      await get(
        ctx,
        `${ctx.src.onvista}/instruments/${inst.entityType}/${inst.entityValue}/eod_history?idNotation=${inst.idNotation}&range=Y5&startDate=${start}`,
      ),
    ).filter((p) => p.date >= start && p.date < today);
    out.push(...page);
    const last = page.at(-1)?.date;
    if (!last || addDays(last, 7) >= today) break;
    start = addDays(last, 1);
  }
  return out;
}

const moves = (t: { type: string }) => t.type === 'buy' || t.type === 'sell';

/**
 * A split onvista lists, applied once to a holding held before it: the trades before it in the
 * new units, and the prices typed or imported before it divided (onvista's are fetched again,
 * adjusted). True when it was applied now.
 */
async function applySplit(
  prisma: PrismaClient,
  holdingId: string,
  split: OnvistaSplit,
): Promise<boolean> {
  const ratio = splitRatio(split.factor);
  const exDate = parseDay(split.date)!;
  const purpose = !ratio
    ? `Price adjustment ×${split.factor} (onvista)`
    : ratio.num >= ratio.den
      ? `Split ${ratio.den}:${ratio.num}`
      : `Reverse split ${ratio.den}:${ratio.num}`;
  return prisma.$transaction(async (tx) => {
    const known = await tx.holdingAction.findFirst({
      where: { holdingId, exDate, purpose },
    });
    if (known) return false;
    const trades = await tx.holdingTrade.findMany({ where: { holdingId } });
    const earlier = trades.filter((t) => moves(t) && t.date < exDate);
    const before = earlier.reduce((s, t) => s + (t.type === 'buy' ? t.units : -t.units), 0n);
    if (before <= 0n) return false; // not held when it happened
    if (!ratio) {
      // no clean split (a spin-off's price adjustment, say): units unchanged, the user checks
      await tx.holdingAction.create({
        data: {
          holdingId,
          exDate,
          purpose,
          kind: 'review',
          status: 'review',
          unitsBefore: before,
          unitsAfter: before,
        },
      });
      return false;
    }
    for (const t of earlier) {
      await tx.holdingTrade.update({
        where: { id: t.id },
        data: { units: scale(t.units, ratio.num, ratio.den) },
      });
    }
    const prices = await tx.holdingPrice.findMany({
      where: { holdingId, date: { lt: exDate }, source: { not: 'onvista' } },
    });
    for (const p of prices) {
      await tx.holdingPrice.update({
        where: { id: p.id },
        data: { price: scale(p.price, ratio.den, ratio.num) },
      });
    }
    await tx.holdingAction.create({
      data: {
        holdingId,
        exDate,
        purpose,
        kind: ratio.num >= ratio.den ? 'split' : 'consolidation',
        status: 'applied',
        num: ratio.num,
        den: ratio.den,
        unitsBefore: before,
        unitsAfter: earlier.reduce(
          (s, t) => s + (t.type === 'buy' ? 1n : -1n) * scale(t.units, ratio.num, ratio.den),
          0n,
        ),
      },
    });
    return true;
  });
}

/** The world holdings of the families that want prices: closes since the last one, and splits. */
async function holdingsRun(ctx: Ctx, familyIds: string[], today: string) {
  const holdings = await ctx.prisma.holding.findMany({
    where: {
      familyId: { in: familyIds },
      archived: false,
      currency: { not: 'INR' },
      symbol: { not: null },
    },
    include: {
      trades: { select: { date: true, type: true, units: true } },
      prices: { orderBy: { date: 'desc' }, select: { date: true, source: true, price: true } },
    },
  });
  const fetchedAt = new Date().toISOString();
  for (const id of familyIds) {
    outcomes.set(id, { fetchedAt, updated: 0, notFound: [], errors: [] });
  }
  // one holding failing does not stop the others; said to its family only
  for (const h of holdings) {
    try {
      await holdingRun(ctx, h, today);
    } catch (err) {
      outcomes
        .get(h.familyId)!
        .errors.push(`${h.name}: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }
}

/** Ten-place fractions rounded to six: a few micro-units left are none. */
const DUST = 10n;
/** A close this far from the last one kept, without a split listed, waits (at most a week). */
const JUMP = { low: 0.6, high: 1.67, waitDays: 7 };

type WorldHolding = {
  id: string;
  name: string;
  familyId: string;
  symbol: string | null;
  currency: string;
  trades: { date: Date; type: string; units: bigint }[];
  /** newest first */
  prices: { date: Date; source: string; price: bigint }[];
};

async function holdingRun(ctx: Ctx, h: WorldHolding, today: string) {
  if (!ISIN.test(h.symbol!)) return;
  const held = h.trades
    .filter(moves)
    .reduce((s, t) => s + (t.type === 'buy' ? t.units : -t.units), 0n);
  if (held <= DUST) return;
  const outcome = outcomes.get(h.familyId)!;
  let inst = await resolve(ctx, h.symbol!, h.currency, today);
  if (!inst?.idNotation) {
    outcome.notFound.push(h.symbol!);
    return;
  }
  const quote = () => inst as typeof inst & { idNotation: string };
  const first = h.trades.map((t) => formatDay(t.date)).sort()[0]!;
  const last = h.prices.find((p) => p.source === 'onvista');
  const from = last ? addDays(formatDay(last.date), 1) : first;
  let points = from >= today ? [] : await closes(ctx, quote(), from, today);
  // a close far from the last one kept: a split may have happened since the list was read
  const kept = h.prices[0];
  const jump = kept && points[0] ? points[0].close / Number(kept.price) : 1;
  const jumped = jump < JUMP.low || jump > JUMP.high;
  if (jumped && !ctx.rechecked.has(h.symbol!)) {
    ctx.rechecked.add(h.symbol!);
    inst = (await resolve(ctx, h.symbol!, h.currency, today, true)) ?? inst;
  }
  let applied = false;
  for (const s of JSON.parse(inst.splits) as OnvistaSplit[]) {
    if (s.date > first && s.date <= today)
      applied = (await applySplit(ctx.prisma, h.id, s)) || applied;
  }
  if (applied) {
    // the whole history again, as onvista adjusts it: the closes kept before are in old units
    points = await closes(ctx, quote(), first, today);
  } else if (jumped && addDays(formatDay(kept!.date), JUMP.waitDays) >= today) {
    // no split listed (yet): kept as it was, asked again on the next run
    outcome.errors.push(
      `${h.name}: the price moved ×${jump.toFixed(2)} — kept until onvista lists a split (a week at most).`,
    );
    return;
  }
  const manual = new Set(
    h.prices.filter((p) => p.source === 'manual').map((p) => formatDay(p.date)),
  );
  const rows = points.filter((p) => !manual.has(p.date));
  for (let k = 0; k < rows.length; k += 500) {
    await ctx.prisma.$transaction(
      rows.slice(k, k + 500).map((p) => {
        const date = parseDay(p.date)!;
        return ctx.prisma.holdingPrice.upsert({
          where: { holdingId_date: { holdingId: h.id, date } },
          create: { holdingId: h.id, date, price: p.close, source: 'onvista' },
          update: { price: p.close, source: 'onvista' },
        });
      }),
    );
  }
  if (points.length) outcome.updated++;
}

async function lastPoint(prisma: PrismaClient, series: string) {
  const p = await prisma.benchmarkPoint.findFirst({
    where: { series },
    orderBy: { date: 'desc' },
  });
  return p ? formatDay(p.date) : null;
}
async function storePoints(
  prisma: PrismaClient,
  series: string,
  points: { date: string; value: number }[],
) {
  for (let k = 0; k < points.length; k += 500) {
    await prisma.$transaction(
      points.slice(k, k + 500).map((p) => {
        const date = parseDay(p.date)!;
        return prisma.benchmarkPoint.upsert({
          where: { series_date: { series, date } },
          create: { series, date, value: p.value },
          update: { value: p.value },
        });
      }),
    );
  }
}

/** The euro ETFs since 2020, then each day. */
async function benchmarksRun(ctx: Ctx, today: string) {
  // one failing does not stop the others
  const failed: string[] = [];
  for (const b of WORLD_BENCHMARKS) {
    try {
      const last = await lastPoint(ctx.prisma, b.series);
      const from = last ? addDays(last, 1) : HISTORY_FROM;
      if (from >= today) continue;
      const inst = await resolve(ctx, b.isin, 'EUR', today);
      if (!inst?.idNotation) throw new Error(`onvista has no euro price for ${b.isin}`);
      const points = await closes(ctx, inst as typeof inst & { idNotation: string }, from, today);
      await storePoints(
        ctx.prisma,
        b.series,
        points.map((p) => ({ date: p.date, value: p.close })),
      );
    } catch (err) {
      failed.push(`${b.series}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed.length) throw new Error(failed.join('; '));
}

/** US dollars per euro (ECB reference rate), since 2020: turns the world gold price into euros. */
async function usdRun(ctx: Ctx, today: string) {
  const last = await lastPoint(ctx.prisma, 'usdPerEur');
  const from = last ? addDays(last, 1) : HISTORY_FROM;
  if (from > today) return;
  const res = await ctx.fetchText(
    `${ctx.src.ecb}/D.USD.EUR.SP00.A?startPeriod=${from}&format=csvdata`,
  );
  // nothing published since: the ECB answers 404, or 200 with nothing at all (asked from today,
  // before the afternoon's rate is out)
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`the ECB answered ${res.status}`);
  const body = (await res.text()).trim();
  if (body === '') return;
  const [head, ...rows] = body.split(/\r?\n/);
  const cols = (head ?? '').split(',');
  const [d, v] = [cols.indexOf('TIME_PERIOD'), cols.indexOf('OBS_VALUE')];
  if (d < 0 || v < 0) throw new Error('the ECB sent something else than its rates');
  await storePoints(
    ctx.prisma,
    'usdPerEur',
    rows
      .map((r) => r.split(','))
      .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c[d] ?? '') && Number(c[v]) > 0)
      .map((c) => ({ date: c[d]!, value: Math.round(Number(c[v]) * 1_000_000) })),
  );
}

let running: Promise<string[]> | null = null;

/**
 * One run for every family that wants daily prices: their world holdings, then the euro
 * markets. The steps fail on their own; what failed is returned (and kept for the status).
 */
export function refreshWorldPrices(
  prisma: PrismaClient,
  fetchText: FetchText,
  today: string,
  src: WorldSources = DEFAULT_WORLD_SOURCES,
  pauseMs = 300,
): Promise<string[]> {
  running ??= (async () => {
    const ctx = { prisma, fetchText, src, pauseMs, rechecked: new Set<string>() };
    const families = await prisma.family.findMany({
      where: { livePrices: true },
      select: { id: true },
    });
    if (families.length === 0) return [];
    const errors: string[] = [];
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
    // the holdings' failures go to their own family (see holdingsRun)
    await holdingsRun(
      ctx,
      families.map((f) => f.id),
      today,
    );
    for (const [step, fn] of [
      ['World markets not updated', () => benchmarksRun(ctx, today)],
      ['Euro gold not updated', () => usdRun(ctx, today)],
    ] as const) {
      try {
        await fn();
      } catch (err) {
        errors.push(`${step}: ${message(err)}.`);
      }
    }
    lastError = errors.length ? errors.join(' ') : null;
    return errors;
  })().finally(() => {
    running = null;
  });
  return running;
}

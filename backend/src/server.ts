import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { anthropicClient } from './ai/client.js';
import { loadConfig } from './config.js';
import { liveRatesWanted, refreshLiveRates } from './services/liveRateService.js';
import { livePricesWanted, refreshLivePrices } from './services/livePriceService.js';
import { refreshWorldPrices } from './services/worldPriceService.js';
import { checkAllDividends } from './services/corporateHistoryService.js';
import { backfillHistory } from './services/marketHistoryService.js';
import { generateDue } from './services/recurringService.js';
import { todayLocal } from './lib/dates.js';

const config = loadConfig();
const prisma = new PrismaClient();
await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');

const frontendDist =
  config.NODE_ENV === 'production'
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
    : undefined;

const app = await buildApp({
  prisma,
  config,
  logger: true,
  frontendDist,
  fetchRates: (url) => fetch(url, { signal: AbortSignal.timeout(15_000) }),
  loginRateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' },
  ratesUrl: config.RATES_URL,
  // NSE's archive refuses requests without a browser-like agent.
  fetchPrices: (url) =>
    fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (myPiggyBank)', Accept: 'text/csv,*/*' },
      signal: AbortSignal.timeout(20_000),
    }),
  pricesUrl: config.PRICES_URL,
  historyUrl: config.NSE_HISTORY_URL,
  goldSources: {
    ibja: config.IBJA_URL,
    usd: config.GOLD_PRICE_URL,
    history: config.GOLD_HISTORY_URL,
  },
  worldSources: { onvista: config.ONVISTA_URL, ecb: config.ECB_URL },
  ai: config.ANTHROPIC_API_KEY
    ? {
        client: anthropicClient({
          apiKey: config.ANTHROPIC_API_KEY,
          model: config.AI_MODEL,
          baseURL: config.ANTHROPIC_BASE_URL,
        }),
        model: config.AI_MODEL,
        monthlyTokens: config.AI_MONTHLY_TOKENS,
      }
    : null,
});

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.HOST, port: config.PORT });

// Recurring transactions: create everything due now, then check again every hour.
const runRecurring = () =>
  generateDue(prisma, todayLocal())
    .then(({ created }) => created && app.log.info({ created }, 'recurring transactions created'))
    .catch((err) => app.log.error(err, 'recurring generation failed'));
await runRecurring();
setInterval(runRecurring, 60 * 60 * 1000).unref();

// Live exchange rates: only downloaded when a family chose them; checked every 6 hours.
const runRates = async () => {
  if (!app.liveRates || !(await liveRatesWanted(prisma))) return;
  const status = await refreshLiveRates(
    prisma,
    app.liveRates.fetch,
    todayLocal(),
    app.liveRates.url,
  );
  if (status.lastError) app.log.warn({ error: status.lastError }, 'live rate download failed');
};
void runRates().catch((err) => app.log.error(err, 'live rate download failed'));
setInterval(() => void runRates().catch(() => {}), 6 * 60 * 60 * 1000).unref();

// NSE closing prices: only downloaded when a family chose them; checked every 6 hours.
const runPrices = async () => {
  if (!app.livePrices || !(await livePricesWanted(prisma))) return;
  const status = await refreshLivePrices(
    prisma,
    app.livePrices.fetch,
    todayLocal(),
    app.livePrices.url,
    undefined,
    app.livePrices.gold,
  );
  if (status.lastError) app.log.warn({ error: status.lastError }, 'NSE price download failed');
  if (status.warning) app.log.warn({ warning: status.warning }, 'market data partly updated');
  // shares outside India and the euro markets (onvista, the ECB): on their own, after NSE
  const world = await refreshWorldPrices(
    prisma,
    app.livePrices.fetch,
    todayLocal(),
    app.livePrices.world,
    app.livePrices.pauseMs,
  );
  if (world.length) app.log.warn({ errors: world }, 'world prices partly updated');
  // then dividends and gold bond interest from NSE's history (once a day per family)
  const nse = {
    fetch: app.livePrices.fetch,
    historyUrl: app.livePrices.historyUrl,
    pricesUrl: app.livePrices.url,
    pauseMs: app.livePrices.pauseMs,
  };
  const { added } = await checkAllDividends(prisma, nse, (familyId, err) =>
    app.log.error({ err, familyId }, 'dividend check failed'),
  );
  if (added) app.log.info({ added }, 'dividends and interest added');
  // and the market's history back to the first trade (with the splits the check looked up)
  try {
    const filled = await backfillHistory(prisma, {
      ...nse,
      goldHistoryUrl: app.livePrices.gold.history,
    });
    if (filled.weeks || filled.worldGold) app.log.info(filled, 'market history filled');
    if (filled.errors.length)
      app.log.warn({ errors: filled.errors }, 'market history partly filled');
  } catch (err) {
    app.log.error(err, 'market history download failed');
  }
};
void runPrices().catch((err) => app.log.error(err, 'NSE price download failed'));
setInterval(
  () => void runPrices().catch((err) => app.log.error(err, 'NSE price download failed')),
  6 * 60 * 60 * 1000,
).unref();

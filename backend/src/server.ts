import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { liveRatesWanted, refreshLiveRates } from './services/liveRateService.js';
import { livePricesWanted, refreshLivePrices } from './services/livePriceService.js';
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
  goldSources: { ibja: config.IBJA_URL, usd: config.GOLD_PRICE_URL },
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
};
void runPrices().catch((err) => app.log.error(err, 'NSE price download failed'));
setInterval(() => void runPrices().catch(() => {}), 6 * 60 * 60 * 1000).unref();

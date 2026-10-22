import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { DEFAULT_RATES_URL, type FetchRates } from './services/liveRateService.js';
import {
  DEFAULT_GOLD_SOURCES,
  DEFAULT_PRICES_URL,
  type FetchText,
  type GoldSources,
} from './services/livePriceService.js';
import { AppError } from './lib/errors.js';
import { SESSION_COOKIE, findSessionUser } from './auth/sessions.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { memberRoutes } from './routes/members.js';
import { familyRoutes } from './routes/family.js';
import { accountRoutes } from './routes/accounts.js';
import { categoryRoutes } from './routes/categories.js';
import { transactionRoutes } from './routes/transactions.js';
import { rateRoutes } from './routes/rates.js';
import { budgetRoutes } from './routes/budget.js';
import { importRoutes } from './routes/import.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { wealthRoutes } from './routes/wealth.js';
import { bankImportRoutes } from './routes/bankImport.js';
import { recurringRoutes } from './routes/recurring.js';
import { goalRoutes } from './routes/goals.js';
import { holdingRoutes } from './routes/holdings.js';
import { DEFAULT_HISTORY_URL } from './services/corporateHistoryService.js';
import { depositRoutes } from './routes/deposits.js';
import { goldRoutes } from './routes/gold.js';
import { reportRoutes } from './routes/reports.js';
import { insightRoutes } from './routes/insights.js';

export type AppConfig = Pick<Config, 'COOKIE_SECURE' | 'ALLOW_REGISTRATION' | 'SESSION_DAYS'>;

export interface AppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger?: boolean;
  /** Absolute path to frontend/dist; when set, the SPA is served from Fastify. */
  frontendDist?: string;
  loginRateLimit?: { max: number; timeWindow: string };
  /** Downloads live exchange rates; without it the server never goes online for rates. */
  fetchRates?: FetchRates;
  ratesUrl?: string;
  /** Downloads NSE closing prices; without it the server never goes online for prices. */
  fetchPrices?: FetchText;
  pricesUrl?: string;
  historyUrl?: string;
  /** pause between requests to NSE's website (be gentle); 0 in tests */
  nsePauseMs?: number;
  /** Indian (IBJA) and world gold price sources. */
  goldSources?: GoldSources;
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('prisma', opts.prisma);
  app.decorate('appConfig', opts.config);
  app.decorate(
    'liveRates',
    opts.fetchRates ? { fetch: opts.fetchRates, url: opts.ratesUrl ?? DEFAULT_RATES_URL } : null,
  );
  app.decorate(
    'livePrices',
    opts.fetchPrices
      ? {
          fetch: opts.fetchPrices,
          url: opts.pricesUrl ?? DEFAULT_PRICES_URL,
          gold: opts.goldSources ?? DEFAULT_GOLD_SOURCES,
          historyUrl: opts.historyUrl ?? DEFAULT_HISTORY_URL,
          pauseMs: opts.nsePauseMs ?? 300,
        }
      : null,
  );
  app.decorateRequest('user', null);

  // Only JSON bodies are accepted; text/plain is a CORS-"simple" type usable for CSRF.
  app.removeContentTypeParser('text/plain');

  // Forcing HTTPS upgrades would break plain-HTTP use (localhost / home network).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: opts.config.COOKIE_SECURE ? [] : null },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later'),
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    // Two requests creating the same thing at once: the loser hits the unique index.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'This already exists — refresh and try again' },
      });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });

  // CSRF: SameSite=Strict does not stop other origins on the same site (e.g. another
  // app on localhost:9999), so unsafe methods must come from this exact origin.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const foreignOrigin = origin !== undefined && safeHost(origin) !== req.headers.host;
    if (site === 'cross-site' || site === 'same-site' || foreignOrigin) {
      throw new AppError(403, 'CROSS_ORIGIN_REQUEST', 'Cross-origin requests are not allowed');
    }
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await findSessionUser(app.prisma, token) : null;
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, {
        loginRateLimit: opts.loginRateLimit ?? { max: 10, timeWindow: '1 minute' },
      });
      await api.register(memberRoutes);
      await api.register(familyRoutes);
      await api.register(accountRoutes);
      await api.register(categoryRoutes);
      await api.register(transactionRoutes);
      await api.register(rateRoutes);
      await api.register(budgetRoutes);
      await api.register(importRoutes);
      await api.register(dashboardRoutes);
      await api.register(wealthRoutes);
      await api.register(bankImportRoutes);
      await api.register(recurringRoutes);
      await api.register(goalRoutes);
      await api.register(holdingRoutes);
      await api.register(depositRoutes);
      await api.register(goldRoutes);
      await api.register(reportRoutes);
      await api.register(insightRoutes);
    },
    { prefix: '/api' },
  );

  if (opts.frontendDist) {
    await app.register(fastifyStatic, { root: opts.frontendDist, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (opts.frontendDist && req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  return app;
}

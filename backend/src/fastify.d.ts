import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './app.js';
import type { AuthUser } from './auth/sessions.js';
import type { FetchRates } from './services/liveRateService.js';
import type { FetchText } from './services/livePriceService.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    appConfig: AppConfig;
    liveRates: { fetch: FetchRates; url: string } | null;
    livePrices: { fetch: FetchText; url: string } | null;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './app.js';
import type { AuthUser } from './auth/sessions.js';
import type { FetchRates } from './services/liveRateService.js';
import type { FetchText, GoldSources } from './services/livePriceService.js';
import type { WorldSources } from './services/worldPriceService.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    appConfig: AppConfig;
    liveRates: { fetch: FetchRates; url: string } | null;
    livePrices: {
      fetch: FetchText;
      url: string;
      gold: GoldSources;
      /** NSE's corporate-action history */
      historyUrl: string;
      pauseMs: number;
      /** onvista (shares outside India) and the ECB (dollars per euro) */
      world: WorldSources;
    } | null;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

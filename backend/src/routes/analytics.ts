import type { FastifyPluginAsync } from 'fastify';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { todayLocal } from '../lib/dates.js';
import { currencyAnalytics, liveQuotes } from '../services/analyticsService.js';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/analytics/currencies', async (req) => ({
    data: await currencyAnalytics(
      app.prisma,
      currentUser(req).familyId,
      app.livePrices ? { fetchText: app.livePrices.fetch, ecbUrl: app.livePrices.world.ecb } : null,
      todayLocal(),
    ),
  }));

  // the pairs during the day: the page asks every few minutes while it is open
  app.get('/analytics/currencies/live', async () => ({
    data: await liveQuotes(
      app.livePrices
        ? { fetchText: app.livePrices.fetch, onvistaUrl: app.livePrices.world.onvista }
        : null,
    ),
  }));
};

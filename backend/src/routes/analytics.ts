import type { FastifyPluginAsync } from 'fastify';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { todayLocal } from '../lib/dates.js';
import { currencyAnalytics } from '../services/analyticsService.js';

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
};

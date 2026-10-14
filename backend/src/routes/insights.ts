import type { FastifyPluginAsync } from 'fastify';
import { ViewQuery } from '../domain/currency.js';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { getInsights } from '../services/insightService.js';

export const insightRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.get('/insights', async (req) => ({
    data: await getInsights(
      app.prisma,
      currentUser(req).familyId,
      parse(ViewQuery, req.query).currency,
    ),
  }));
};

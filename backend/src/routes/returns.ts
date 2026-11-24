import type { FastifyPluginAsync } from 'fastify';
import { ViewQuery } from '../domain/currency.js';
import { RangeQuery } from '../domain/history.js';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { investmentHistory, investmentReturns } from '../services/returnsService.js';

/** Returns of every kind of investment, side by side. */
export const returnRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  app.get('/investments/returns', async (req) => ({
    data: await investmentReturns(
      app.prisma,
      currentUser(req).familyId,
      parse(ViewQuery, req.query).currency,
    ),
  }));
  app.get('/investments/history', async (req) => ({
    data: await investmentHistory(
      app.prisma,
      currentUser(req).familyId,
      parse(ViewQuery, req.query).currency,
      parse(RangeQuery, req.query).range,
    ),
  }));
};

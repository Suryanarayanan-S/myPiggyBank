import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { DashboardQuery, getDashboard } from '../services/dashboardService.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/dashboard', async (req) => {
    const { from, to } = parse(DashboardQuery, req.query);
    return { data: await getDashboard(app.prisma, currentUser(req).familyId, from, to) };
  });
};

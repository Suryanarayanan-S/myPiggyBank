import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { aiStatus } from '../services/aiService.js';
import { CategorizeInput, suggestCategories } from '../services/aiCategoryService.js';

export const aiRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/ai/status', async (req) => ({
    data: await aiStatus(app.prisma, currentUser(req).familyId, app.ai),
  }));

  // the same body size as the bank import it follows; each request may cost money: a few a minute
  const limits = {
    bodyLimit: 15 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };
  app.post('/ai/categorize', limits, async (req) => ({
    data: await suggestCategories(
      app.prisma,
      currentUser(req).familyId,
      app.ai,
      parse(CategorizeInput, req.body),
    ),
  }));
};

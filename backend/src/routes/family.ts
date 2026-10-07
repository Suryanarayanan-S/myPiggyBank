import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { FamilyInput, getFamily, updateFamily } from '../services/familyService.js';

export const familyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/family', async (req) => ({
    data: await getFamily(app.prisma, currentUser(req).familyId),
  }));

  app.put('/family', async (req) => {
    const input = parse(FamilyInput, req.body);
    return { data: await updateFamily(app.prisma, currentUser(req).familyId, input) };
  });
};

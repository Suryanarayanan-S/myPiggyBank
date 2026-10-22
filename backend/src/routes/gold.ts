import type { FastifyPluginAsync } from 'fastify';
import { ViewQuery } from '../domain/currency.js';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as g from '../services/goldService.js';

/** Physical gold: jewellery, coins and bars, by weight. */
export const goldRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;

  app.get('/gold', async (req) => ({
    data: await g.listGold(app.prisma, fam(req), parse(ViewQuery, req.query).currency),
  }));
  app.post('/gold', async (req, reply) =>
    reply.status(201).send({
      data: await g.createGold(app.prisma, fam(req), parse(g.GoldCreate, req.body)),
    }),
  );
  app.put('/gold/:id', async (req) => ({
    data: await g.updateGold(app.prisma, fam(req), id(req), parse(g.GoldUpdate, req.body)),
  }));
  app.delete('/gold/:id', async (req) => {
    await g.deleteGold(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
};

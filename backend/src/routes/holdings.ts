import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ViewQuery } from '../domain/currency.js';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as h from '../services/holdingService.js';

const SubParams = z.object({ id: z.uuid(), subId: z.uuid() });

export const holdingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;
  const sub = (req: { params: unknown }) => parse(SubParams, req.params);

  app.get('/holdings', async (req) => ({
    data: await h.listHoldings(app.prisma, fam(req), parse(ViewQuery, req.query).currency),
  }));
  app.post('/holdings', async (req, reply) =>
    reply.status(201).send({
      data: await h.createHolding(app.prisma, fam(req), parse(h.HoldingCreate, req.body)),
    }),
  );
  app.put('/holdings/:id', async (req) => ({
    data: await h.updateHolding(app.prisma, fam(req), id(req), parse(h.HoldingUpdate, req.body)),
  }));
  app.delete('/holdings/:id', async (req) => {
    await h.deleteHolding(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
  app.post('/holdings/:id/trades', async (req) => ({
    data: await h.addTrade(app.prisma, fam(req), id(req), parse(h.TradeInput, req.body)),
  }));
  app.delete('/holdings/:id/trades/:subId', async (req) => {
    const p = sub(req);
    return { data: await h.deleteTrade(app.prisma, fam(req), p.id, p.subId) };
  });
  app.post('/holdings/:id/prices', async (req) => ({
    data: await h.setPrice(app.prisma, fam(req), id(req), parse(h.PriceInput, req.body)),
  }));
  app.delete('/holdings/:id/prices/:subId', async (req) => {
    const p = sub(req);
    return { data: await h.deletePrice(app.prisma, fam(req), p.id, p.subId) };
  });
};

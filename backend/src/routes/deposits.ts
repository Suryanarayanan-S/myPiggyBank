import type { FastifyPluginAsync } from 'fastify';
import { ViewQuery } from '../domain/currency.js';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as d from '../services/depositService.js';

/** Fixed deposits (recurring ones later). */
export const depositRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;

  app.get('/deposits', async (req) => ({
    data: await d.listDeposits(app.prisma, fam(req), parse(ViewQuery, req.query).currency),
  }));
  app.post('/deposits', async (req, reply) =>
    reply.status(201).send({
      data: await d.createDeposit(app.prisma, fam(req), parse(d.DepositCreate, req.body)),
    }),
  );
  app.put('/deposits/:id', async (req) => ({
    data: await d.updateDeposit(app.prisma, fam(req), id(req), parse(d.DepositUpdate, req.body)),
  }));
  app.delete('/deposits/:id', async (req) => {
    await d.deleteDeposit(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
};

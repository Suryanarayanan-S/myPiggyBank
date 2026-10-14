import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as g from '../services/goalService.js';

const EntryParams = z.object({ id: z.uuid(), entryId: z.uuid() });

export const goalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;

  app.get('/goals', async (req) => ({ data: await g.listGoals(app.prisma, fam(req)) }));
  app.post('/goals', async (req, reply) =>
    reply
      .status(201)
      .send({ data: await g.createGoal(app.prisma, fam(req), parse(g.GoalCreate, req.body)) }),
  );
  app.put('/goals/:id', async (req) => ({
    data: await g.updateGoal(app.prisma, fam(req), id(req), parse(g.GoalUpdate, req.body)),
  }));
  app.delete('/goals/:id', async (req) => {
    await g.deleteGoal(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
  app.post('/goals/:id/entries', async (req) => ({
    data: await g.addEntry(app.prisma, fam(req), id(req), parse(g.EntryInput, req.body)),
  }));
  app.delete('/goals/:id/entries/:entryId', async (req) => {
    const p = parse(EntryParams, req.params);
    return { data: await g.deleteEntry(app.prisma, fam(req), p.id, p.entryId) };
  });
};

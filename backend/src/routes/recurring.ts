import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parse } from '../lib/validate.js';
import { formatDay } from '../lib/dates.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as r from '../services/recurringService.js';

export const recurringRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;

  app.get('/recurring', async (req) => ({ data: await r.listRecurring(app.prisma, fam(req)) }));
  app.get('/recurring/upcoming', async (req) => {
    const { days } = parse(r.UpcomingQuery, req.query);
    return { data: await r.upcoming(app.prisma, fam(req), days) };
  });
  app.post('/recurring', async (req, reply) =>
    reply.status(201).send({
      data: await r.createRecurring(app.prisma, fam(req), parse(r.RecurringCreate, req.body)),
    }),
  );
  app.put('/recurring/:id', async (req) => ({
    data: await r.updateRecurring(
      app.prisma,
      fam(req),
      parse(IdParams, req.params).id,
      parse(r.RecurringUpdate, req.body),
    ),
  }));
  app.delete('/recurring/:id', async (req) => {
    await r.deleteRecurring(app.prisma, fam(req), parse(IdParams, req.params).id);
    return { data: { ok: true } };
  });
  app.post('/recurring/run', async (req) => ({
    data: await r.generateDue(app.prisma, formatDay(new Date()), fam(req)),
  }));
};

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as w from '../services/wealthService.js';

const SubParams = z.object({ id: z.uuid(), subId: z.uuid() });

export const wealthRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;

  app.get('/assets', async (req) => ({ data: await w.listAssets(app.prisma, fam(req)) }));
  app.post('/assets', async (req, reply) =>
    reply
      .status(201)
      .send({ data: await w.createAsset(app.prisma, fam(req), parse(w.AssetCreate, req.body)) }),
  );
  app.put('/assets/:id', async (req) => ({
    data: await w.updateAsset(app.prisma, fam(req), id(req), parse(w.AssetUpdate, req.body)),
  }));
  app.delete('/assets/:id', async (req) => {
    await w.deleteAsset(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
  app.post('/assets/:id/valuations', async (req) => ({
    data: await w.addValuation(app.prisma, fam(req), id(req), parse(w.ValuationInput, req.body)),
  }));
  app.delete('/assets/:id/valuations/:subId', async (req) => {
    const p = parse(SubParams, req.params);
    return { data: await w.deleteValuation(app.prisma, fam(req), p.id, p.subId) };
  });

  app.get('/liabilities', async (req) => ({ data: await w.listLiabilities(app.prisma, fam(req)) }));
  app.post('/liabilities', async (req, reply) =>
    reply
      .status(201)
      .send({
        data: await w.createLiability(app.prisma, fam(req), parse(w.LiabilityCreate, req.body)),
      }),
  );
  app.put('/liabilities/:id', async (req) => ({
    data: await w.updateLiability(
      app.prisma,
      fam(req),
      id(req),
      parse(w.LiabilityUpdate, req.body),
    ),
  }));
  app.delete('/liabilities/:id', async (req) => {
    await w.deleteLiability(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
  app.post('/liabilities/:id/balances', async (req) => ({
    data: await w.addBalance(app.prisma, fam(req), id(req), parse(w.BalanceInput, req.body)),
  }));
  app.delete('/liabilities/:id/balances/:subId', async (req) => {
    const p = parse(SubParams, req.params);
    return { data: await w.deleteBalance(app.prisma, fam(req), p.id, p.subId) };
  });

  app.get('/net-worth', async (req) => ({ data: await w.getNetWorth(app.prisma, fam(req)) }));
  app.post('/net-worth/snapshots', async (req, reply) =>
    reply
      .status(201)
      .send({
        data: await w.createSnapshot(app.prisma, fam(req), parse(w.SnapshotInput, req.body)),
      }),
  );
  app.put('/net-worth/snapshots/:id', async (req) => ({
    data: await w.updateSnapshot(app.prisma, fam(req), id(req), parse(w.SnapshotUpdate, req.body)),
  }));
  app.delete('/net-worth/snapshots/:id', async (req) => {
    await w.deleteSnapshot(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
};

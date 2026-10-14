import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { AppError } from '../lib/errors.js';
import { liveStatus, refreshLiveRates } from '../services/liveRateService.js';
import { RateInput, deleteRate, listRates, upsertRate } from '../services/rateService.js';
import { todayLocal } from '../lib/dates.js';

export const rateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/exchange-rates', async (req) => ({
    data: await listRates(app.prisma, currentUser(req).familyId),
  }));

  app.put('/exchange-rates', async (req) => {
    const input = parse(RateInput, req.body);
    return { data: await upsertRate(app.prisma, currentUser(req).familyId, input) };
  });

  app.get('/exchange-rates/live', async () => ({ data: await liveStatus(app.prisma) }));

  app.post('/exchange-rates/live/refresh', async () => {
    if (!app.liveRates) {
      throw new AppError(503, 'LIVE_RATES_OFF', 'This server is not set up to download rates');
    }
    const today = todayLocal();
    return {
      data: await refreshLiveRates(app.prisma, app.liveRates.fetch, today, app.liveRates.url),
    };
  });

  app.delete('/exchange-rates/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteRate(app.prisma, currentUser(req).familyId, id);
    return { data: { ok: true } };
  });
};

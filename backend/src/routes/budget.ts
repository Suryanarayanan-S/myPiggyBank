import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  LimitsInput,
  MonthParams,
  copyPreviousLimits,
  getSummary,
  setLimits,
} from '../services/budgetService.js';
import {
  MonthEntryInput,
  MonthEntryQuery,
  getMonthEntry,
  saveMonthEntry,
} from '../services/monthEntryService.js';

export const budgetRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/budget/:month', async (req) => {
    const { month } = parse(MonthParams, req.params);
    return { data: await getSummary(app.prisma, currentUser(req).familyId, month) };
  });

  app.put('/budget/:month/limits', async (req) => {
    const { month } = parse(MonthParams, req.params);
    const input = parse(LimitsInput, req.body);
    return { data: await setLimits(app.prisma, currentUser(req).familyId, month, input) };
  });

  app.post('/budget/:month/copy-previous', async (req) => {
    const { month } = parse(MonthParams, req.params);
    return { data: await copyPreviousLimits(app.prisma, currentUser(req).familyId, month) };
  });

  app.get('/month-entry/:month', async (req) => {
    const { month } = parse(MonthParams, req.params);
    const { accountId } = parse(MonthEntryQuery, req.query);
    return { data: await getMonthEntry(app.prisma, currentUser(req).familyId, month, accountId) };
  });

  app.put('/month-entry/:month', async (req) => {
    const { month } = parse(MonthParams, req.params);
    const input = parse(MonthEntryInput, req.body);
    return { data: await saveMonthEntry(app.prisma, currentUser(req).familyId, month, input) };
  });
};

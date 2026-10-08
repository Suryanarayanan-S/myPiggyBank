import type { FastifyPluginAsync } from 'fastify';
import { ViewQuery } from '../domain/currency.js';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  AccountCreate,
  AccountUpdate,
  accountsTotal,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from '../services/accountService.js';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/accounts', async (req) => ({
    data: await listAccounts(app.prisma, currentUser(req).familyId),
  }));

  app.get('/accounts/total', async (req) => ({
    data: await accountsTotal(
      app.prisma,
      currentUser(req).familyId,
      parse(ViewQuery, req.query).currency,
    ),
  }));

  app.post('/accounts', async (req, reply) => {
    const input = parse(AccountCreate, req.body);
    const account = await createAccount(app.prisma, currentUser(req).familyId, input);
    return reply.status(201).send({ data: account });
  });

  app.put('/accounts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(AccountUpdate, req.body);
    return { data: await updateAccount(app.prisma, currentUser(req).familyId, id, input) };
  });

  app.delete('/accounts/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteAccount(app.prisma, currentUser(req).familyId, id);
    return { data: { ok: true } };
  });
};

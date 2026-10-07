import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  ListQuery,
  TransactionInput,
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../services/transactionService.js';

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/transactions', async (req) => {
    const query = parse(ListQuery, req.query);
    return { data: await listTransactions(app.prisma, currentUser(req).familyId, query) };
  });

  app.post('/transactions', async (req, reply) => {
    const input = parse(TransactionInput, req.body);
    const txn = await createTransaction(app.prisma, currentUser(req).familyId, input);
    return reply.status(201).send({ data: txn });
  });

  app.put('/transactions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(TransactionInput, req.body);
    return { data: await updateTransaction(app.prisma, currentUser(req).familyId, id, input) };
  });

  app.delete('/transactions/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteTransaction(app.prisma, currentUser(req).familyId, id);
    return { data: { ok: true } };
  });
};

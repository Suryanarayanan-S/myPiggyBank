import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  CategoryCreate,
  CategoryUpdate,
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../services/categoryService.js';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/categories', async (req) => ({
    data: await listCategories(app.prisma, currentUser(req).familyId),
  }));

  app.post('/categories', async (req, reply) => {
    const input = parse(CategoryCreate, req.body);
    const category = await createCategory(app.prisma, currentUser(req).familyId, input);
    return reply.status(201).send({ data: category });
  });

  app.put('/categories/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const input = parse(CategoryUpdate, req.body);
    return { data: await updateCategory(app.prisma, currentUser(req).familyId, id, input) };
  });

  app.delete('/categories/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteCategory(app.prisma, currentUser(req).familyId, id);
    return { data: { ok: true } };
  });
};

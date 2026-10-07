import type { FastifyPluginAsync } from 'fastify';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  MemberInput,
  createMember,
  deleteMember,
  listMembers,
  updateMember,
} from '../services/memberService.js';

export const memberRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/members', async (req) => ({
    data: await listMembers(app.prisma, currentUser(req).familyId),
  }));

  app.post('/members', async (req, reply) => {
    const { name } = parse(MemberInput, req.body);
    const member = await createMember(app.prisma, currentUser(req).familyId, name);
    return reply.status(201).send({ data: member });
  });

  app.put('/members/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    const { name } = parse(MemberInput, req.body);
    return { data: await updateMember(app.prisma, currentUser(req).familyId, id, name) };
  });

  app.delete('/members/:id', async (req) => {
    const { id } = parse(IdParams, req.params);
    await deleteMember(app.prisma, currentUser(req).familyId, id);
    return { data: { ok: true } };
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  CommitInput,
  PreviewInput,
  commitImport,
  previewImport,
} from '../services/importService.js';

// A 10 MB workbook is ~13.4 MB as base64.
const bodyLimit = 15 * 1024 * 1024;

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/import/spreadsheet/preview', { bodyLimit }, async (req) => {
    const input = parse(PreviewInput, req.body);
    return { data: await previewImport(app.prisma, currentUser(req).familyId, input) };
  });

  app.post('/import/spreadsheet/commit', { bodyLimit }, async (req) => {
    const input = parse(CommitInput, req.body);
    return { data: await commitImport(app.prisma, currentUser(req).familyId, input) };
  });
};

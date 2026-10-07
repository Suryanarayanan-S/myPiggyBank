import type { FastifyPluginAsync } from 'fastify';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import {
  AnalyzeInput,
  CommitCsvInput,
  CsvPreviewInput,
  analyzeCsv,
  commitCsv,
  previewCsv,
} from '../services/bankImportService.js';
import { ExportQuery, exportTransactionsCsv } from '../services/exportService.js';

const bodyLimit = 15 * 1024 * 1024;

export const bankImportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/import/csv/preview', { bodyLimit }, async (req) => ({
    data: previewCsv(parse(CsvPreviewInput, req.body)),
  }));
  app.post('/import/csv/analyze', { bodyLimit }, async (req) => ({
    data: await analyzeCsv(app.prisma, currentUser(req).familyId, parse(AnalyzeInput, req.body)),
  }));
  app.post('/import/csv/commit', { bodyLimit }, async (req) => ({
    data: await commitCsv(app.prisma, currentUser(req).familyId, parse(CommitCsvInput, req.body)),
  }));

  app.get('/export/transactions.csv', async (req, reply) => {
    const { from, to } = parse(ExportQuery, req.query);
    const csv = await exportTransactionsCsv(app.prisma, currentUser(req).familyId, from, to);
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="transactions-${from}-to-${to}.csv"`)
      .send(csv);
  });
};

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { ReportQuery, YearParams, getYearReport, reportCsv } from '../services/reportService.js';

const Params = z.object({ year: z.string().max(10) });

export const reportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  // "/reports/year/2026" answers JSON, "/reports/year/2026.csv" the same report as a file.
  app.get('/reports/year/:year', async (req, reply) => {
    const raw = parse(Params, req.params).year;
    const csv = raw.endsWith('.csv');
    const { year } = parse(YearParams, { year: csv ? raw.slice(0, -4) : raw });
    const { currency } = parse(ReportQuery, req.query);
    const report = await getYearReport(app.prisma, currentUser(req).familyId, year, currency);
    if (!csv) return { data: report };
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="report-${year}.csv"`)
      .send(reportCsv(report));
  });
};

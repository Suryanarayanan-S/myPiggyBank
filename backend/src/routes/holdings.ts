import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ViewQuery } from '../domain/currency.js';
import { IdParams, parse } from '../lib/validate.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import * as h from '../services/holdingService.js';
import * as hi from '../services/holdingImportService.js';
import * as tb from '../services/holdingTradebookService.js';
import * as ch from '../services/corporateHistoryService.js';
import { benchmarks, livePriceStatus, refreshLivePrices } from '../services/livePriceService.js';
import { AppError } from '../lib/errors.js';
import { parseDay, todayLocal } from '../lib/dates.js';

// A holdings file (base64) plus the other fields.
const bodyLimit = hi.MAX_FILE_CHARS + 64 * 1024;
const BenchmarkQuery = z.object({
  from: z
    .string()
    .refine((d) => parseDay(d) !== null, 'Use a real date as YYYY-MM-DD')
    .optional(),
});
const SubParams = z.object({ id: z.uuid(), subId: z.uuid() });

export const holdingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);
  const fam = (req: Parameters<typeof currentUser>[0]) => currentUser(req).familyId;
  const id = (req: { params: unknown }) => parse(IdParams, req.params).id;
  const sub = (req: { params: unknown }) => parse(SubParams, req.params);

  // A broker's holdings export (Zerodha Kite): preview, then create or update the holdings.
  app.post('/holdings/import/preview', { bodyLimit }, async (req) => ({
    data: await hi.previewHoldingImport(
      app.prisma,
      fam(req),
      parse(hi.HoldingImportInput, req.body),
    ),
  }));
  app.post('/holdings/import/commit', { bodyLimit }, async (req) => ({
    data: await hi.commitHoldingImport(
      app.prisma,
      fam(req),
      parse(hi.HoldingImportInput, req.body),
    ),
  }));
  // A full tradebook (Zerodha Console's format): real buy and sell dates for the holdings.
  app.post('/holdings/tradebook/preview', { bodyLimit }, async (req) => ({
    data: await tb.previewTradebookImport(
      app.prisma,
      fam(req),
      parse(tb.TradebookImportInput, req.body),
    ),
  }));
  app.post('/holdings/tradebook/commit', { bodyLimit }, async (req) => ({
    data: await tb.commitTradebookImport(
      app.prisma,
      fam(req),
      parse(tb.TradebookImportInput, req.body),
    ),
  }));
  app.post('/holdings/move-to-demat', async (req) => ({
    data: await hi.moveToDemat(app.prisma, fam(req), parse(hi.MoveToDematInput, req.body)),
  }));
  // NSE's corporate-action history: dividends, gold bond interest, splits and mergers.
  const sources = () => {
    if (!app.livePrices) {
      throw new AppError(503, 'LIVE_PRICES_OFF', 'This server is not set up to download from NSE');
    }
    return {
      fetch: app.livePrices.fetch,
      historyUrl: app.livePrices.historyUrl,
      pricesUrl: app.livePrices.url,
      pauseMs: app.livePrices.pauseMs,
    };
  };
  // Dividends and gold bond interest: checked each day after the prices, or now on request.
  app.get('/holdings/dividend-check', async (req) => ({
    // available: this server can reach NSE at all
    data: { ...(await ch.dividendCheckStatus(app.prisma, fam(req))), available: !!app.livePrices },
  }));
  // asked for (or after an import): a check already running is followed by a new one
  app.post('/holdings/dividend-check', async (req) => ({
    data: await ch.checkDividends(app.prisma, fam(req), sources(), true),
  }));
  // every payout with the shares held and the amount a share (the Dividends tab)
  app.get('/holdings/payouts', async (req) => ({
    data: await ch.payoutList(app.prisma, fam(req)),
  }));
  app.get('/holdings/events', async (req) => ({
    // only the prices kept by a check: a page view never goes to NSE
    data: await ch.corporateEvents(app.prisma, fam(req), null),
  }));
  // Daily closing prices from NSE (opt-in per family).
  app.get('/holdings/live-prices', async (req) => ({ data: livePriceStatus(fam(req)) }));
  // Nifty 50 and gold (public market data) to compare investments with.
  app.get('/holdings/benchmarks', async (req) => ({
    data: await benchmarks(app.prisma, parse(BenchmarkQuery, req.query).from),
  }));
  app.post('/holdings/live-prices/refresh', async (req) => {
    if (!app.livePrices) {
      throw new AppError(503, 'LIVE_PRICES_OFF', 'This server is not set up to download prices');
    }
    const family = await app.prisma.family.findUnique({ where: { id: fam(req) } });
    if (!family?.livePrices) {
      throw new AppError(403, 'LIVE_PRICES_OFF', 'Switch on daily NSE prices first');
    }
    return {
      data: await refreshLivePrices(
        app.prisma,
        app.livePrices.fetch,
        todayLocal(),
        app.livePrices.url,
        fam(req),
        app.livePrices.gold,
      ),
    };
  });
  app.get('/holdings', async (req) => ({
    data: await h.listHoldings(app.prisma, fam(req), parse(ViewQuery, req.query).currency),
  }));
  app.post('/holdings', async (req, reply) =>
    reply.status(201).send({
      data: await h.createHolding(app.prisma, fam(req), parse(h.HoldingCreate, req.body)),
    }),
  );
  app.put('/holdings/:id', async (req) => ({
    data: await h.updateHolding(app.prisma, fam(req), id(req), parse(h.HoldingUpdate, req.body)),
  }));
  app.delete('/holdings/:id', async (req) => {
    await h.deleteHolding(app.prisma, fam(req), id(req));
    return { data: { ok: true } };
  });
  app.post('/holdings/:id/trades', async (req) => ({
    data: await h.addTrade(app.prisma, fam(req), id(req), parse(h.TradeInput, req.body)),
  }));
  app.delete('/holdings/:id/trades/:subId', async (req) => {
    const p = sub(req);
    return { data: await h.deleteTrade(app.prisma, fam(req), p.id, p.subId) };
  });
  app.post('/holdings/:id/prices', async (req) => ({
    data: await h.setPrice(app.prisma, fam(req), id(req), parse(h.PriceInput, req.body)),
  }));
  app.delete('/holdings/:id/prices/:subId', async (req) => {
    const p = sub(req);
    return { data: await h.deletePrice(app.prisma, fam(req), p.id, p.subId) };
  });
};

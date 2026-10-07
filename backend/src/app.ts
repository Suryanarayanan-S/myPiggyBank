import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';
import { SESSION_COOKIE, findSessionUser } from './auth/sessions.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';

export type AppConfig = Pick<Config, 'COOKIE_SECURE' | 'ALLOW_REGISTRATION' | 'SESSION_DAYS'>;

export interface AppOptions {
  prisma: PrismaClient;
  config: AppConfig;
  logger?: boolean;
  /** Absolute path to frontend/dist; when set, the SPA is served from Fastify. */
  frontendDist?: string;
  loginRateLimit?: { max: number; timeWindow: string };
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('prisma', opts.prisma);
  app.decorate('appConfig', opts.config);
  app.decorateRequest('user', null);

  // Only JSON bodies are accepted; text/plain is a CORS-"simple" type usable for CSRF.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () =>
      new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later'),
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .status(err.statusCode)
        .send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  });

  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await findSessionUser(app.prisma, token) : null;
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, {
        loginRateLimit: opts.loginRateLimit ?? { max: 10, timeWindow: '1 minute' },
      });
    },
    { prefix: '/api' },
  );

  if (opts.frontendDist) {
    await app.register(fastifyStatic, { root: opts.frontendDist, wildcard: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (opts.frontendDist && req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  return app;
}

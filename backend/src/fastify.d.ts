import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './app.js';
import type { AuthUser } from './auth/sessions.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    appConfig: AppConfig;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

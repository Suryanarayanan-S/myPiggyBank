import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return { data: { status: 'ok' } };
  });
};

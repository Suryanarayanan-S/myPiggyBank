import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers.js';

describe('error mapping', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('a unique-constraint race (Prisma P2002) is a 409 CONFLICT, not a 500', async () => {
    app = await makeApp();
    app.get('/race', async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      });
    });
    const res = await app.inject({ method: 'GET', url: '/race' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });
});

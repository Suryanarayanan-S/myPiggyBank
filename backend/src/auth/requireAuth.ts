import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from './sessions.js';

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Please log in');

export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.user) throw unauthenticated();
}

export function currentUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

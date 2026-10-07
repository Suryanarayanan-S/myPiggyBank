import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { AppError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { SESSION_COOKIE, createSession, deleteSession } from '../auth/sessions.js';
import { currentUser, requireAuth } from '../auth/requireAuth.js';
import { getFamily } from '../services/familyService.js';
import { LoginInput, RegisterInput, loginUser, registerUser } from '../services/authService.js';

export interface AuthRoutesOptions {
  loginRateLimit: { max: number; timeWindow: string };
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const startSession = async (reply: FastifyReply, userId: string) => {
    const { token, expiresAt } = await createSession(
      app.prisma,
      userId,
      app.appConfig.SESSION_DAYS,
    );
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: app.appConfig.COOKIE_SECURE,
      expires: expiresAt,
    });
  };
  const limited = { rateLimit: opts.loginRateLimit };

  app.post('/auth/register', { config: limited }, async (req, reply) => {
    if (!app.appConfig.ALLOW_REGISTRATION) {
      throw new AppError(403, 'REGISTRATION_DISABLED', 'Registration is disabled');
    }
    const user = await registerUser(app.prisma, parse(RegisterInput, req.body));
    await startSession(reply, user.id);
    return reply.status(201).send({ data: { user } });
  });

  app.post('/auth/login', { config: limited }, async (req, reply) => {
    const user = await loginUser(app.prisma, parse(LoginInput, req.body));
    await startSession(reply, user.id);
    return { data: { user } };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await deleteSession(app.prisma, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { data: { ok: true } };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req);
    const family = await getFamily(app.prisma, user.familyId);
    return { data: { user, family } };
  });
};

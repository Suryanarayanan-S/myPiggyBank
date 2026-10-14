import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const SESSION_COOKIE = 'pb_session';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  familyId: string;
  memberId: string | null;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function toAuthUser(
  u: { id: string; email: string; name: string; role: string; familyId: string },
  memberId: string | null,
): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, familyId: u.familyId, memberId };
}

export async function createSession(prisma: PrismaClient, userId: string, days: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  // Logins are rare, so this is a cheap moment to forget expired sessions.
  await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function findSessionUser(
  prisma: PrismaClient,
  token: string,
): Promise<AuthUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { member: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return toAuthUser(session.user, session.user.member?.id ?? null);
}

export async function deleteSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

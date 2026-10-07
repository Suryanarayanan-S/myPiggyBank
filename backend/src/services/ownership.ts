import type { Db } from '../lib/db.js';
import { notFound } from '../lib/errors.js';

/** Throws 404 unless the member belongs to the family. */
export async function assertMember(prisma: Db, familyId: string, id: string) {
  const m = await prisma.familyMember.findFirst({ where: { id, familyId } });
  if (!m) throw notFound('Family member');
  return m;
}

export async function assertAccount(prisma: Db, familyId: string, id: string) {
  const a = await prisma.account.findFirst({ where: { id, familyId } });
  if (!a) throw notFound('Account');
  return a;
}

export async function assertCategory(prisma: Db, familyId: string, id: string) {
  const c = await prisma.category.findFirst({ where: { id, familyId } });
  if (!c) throw notFound('Category');
  return c;
}

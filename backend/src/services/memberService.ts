import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError, notFound } from '../lib/errors.js';

export const MemberInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(50)
    .refine(
      (n) => n.toLowerCase() !== 'shared',
      '"Shared" is reserved for family-wide transactions',
    ),
});

export type MemberDto = { id: string; name: string; isUser: boolean };

const toDto = (m: { id: string; name: string; userId: string | null }): MemberDto => ({
  id: m.id,
  name: m.name,
  isUser: m.userId !== null,
});

async function assertNameFree(
  prisma: PrismaClient,
  familyId: string,
  name: string,
  exceptId?: string,
) {
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    select: { id: true, name: true },
  });
  if (members.some((m) => m.id !== exceptId && m.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(409, 'MEMBER_EXISTS', 'A family member with this name already exists');
  }
}

async function getOwned(prisma: PrismaClient, familyId: string, id: string) {
  const member = await prisma.familyMember.findFirst({ where: { id, familyId } });
  if (!member) throw notFound('Family member');
  return member;
}

export async function listMembers(prisma: PrismaClient, familyId: string): Promise<MemberDto[]> {
  const members = await prisma.familyMember.findMany({
    where: { familyId },
    orderBy: { createdAt: 'asc' },
  });
  return members.map(toDto);
}

export async function createMember(prisma: PrismaClient, familyId: string, name: string) {
  await assertNameFree(prisma, familyId, name);
  return toDto(await prisma.familyMember.create({ data: { familyId, name } }));
}

export async function updateMember(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  name: string,
) {
  await getOwned(prisma, familyId, id);
  await assertNameFree(prisma, familyId, name, id);
  return toDto(await prisma.familyMember.update({ where: { id }, data: { name } }));
}

export async function deleteMember(prisma: PrismaClient, familyId: string, id: string) {
  const member = await getOwned(prisma, familyId, id);
  if (member.userId) {
    throw new AppError(
      400,
      'MEMBER_IS_USER',
      'This member is linked to a login and cannot be deleted',
    );
  }
  await prisma.familyMember.delete({ where: { id } });
}

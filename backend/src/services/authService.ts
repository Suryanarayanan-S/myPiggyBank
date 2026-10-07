import { hash, verify } from '@node-rs/argon2';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { toAuthUser, type AuthUser } from '../auth/sessions.js';
import { seedDefaultCategories } from './categoryService.js';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));

export const RegisterInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  familyName: z.string().trim().min(1).max(100).optional(),
});

export const LoginInput = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const emailTaken = () =>
  new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

// Verified against when the email is unknown so both paths cost the same time.
let dummyHash: Promise<string> | undefined;

export async function registerUser(
  prisma: PrismaClient,
  input: z.output<typeof RegisterInput>,
): Promise<AuthUser> {
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw emailTaken();
  const passwordHash = await hash(input.password, ARGON2);
  try {
    return await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: { name: input.familyName ?? `${input.name}'s family` },
      });
      const user = await tx.user.create({
        data: {
          familyId: family.id,
          email: input.email,
          passwordHash,
          name: input.name,
          role: 'owner',
        },
      });
      const member = await tx.familyMember.create({
        data: { familyId: family.id, name: input.name, userId: user.id },
      });
      await seedDefaultCategories(tx, family.id);
      return toAuthUser(user, member.id);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw emailTaken();
    throw e;
  }
}

export async function loginUser(
  prisma: PrismaClient,
  input: z.output<typeof LoginInput>,
): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { member: true },
  });
  if (!user) {
    dummyHash ??= hash('timing-equaliser-password', ARGON2);
    await verify(await dummyHash, input.password);
    throw invalidCredentials();
  }
  if (!(await verify(user.passwordHash, input.password))) throw invalidCredentials();
  return toAuthUser(user, user.member?.id ?? null);
}

export const DeleteAccountInput = z.object({
  password: z.string().min(1, 'Password is required').max(200),
  confirm: z.literal('DELETE', 'Type DELETE to confirm'),
});

/**
 * Deletes the user's login. As the family's only login, the whole family and all its data go
 * with it (cascade); otherwise only the login is removed and the family's data stays.
 */
export async function deleteAccount(
  prisma: PrismaClient,
  user: AuthUser,
  input: z.output<typeof DeleteAccountInput>,
): Promise<{ familyDeleted: boolean }> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verify(row.passwordHash, input.password))) throw invalidCredentials();
  const logins = await prisma.user.count({ where: { familyId: user.familyId } });
  if (logins === 1) {
    await prisma.family.delete({ where: { id: user.familyId } });
    return { familyDeleted: true };
  }
  await prisma.user.delete({ where: { id: user.id } });
  return { familyDeleted: false };
}

import { hash, verify } from '@node-rs/argon2';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { toAuthUser, type AuthUser } from '../auth/sessions.js';

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

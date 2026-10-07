import type { Prisma, PrismaClient } from '@prisma/client';

/** The Prisma client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

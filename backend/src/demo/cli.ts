// npm run seed:demo [-- --reset]   Adds the demo family to the database in DATABASE_URL.
import { PrismaClient } from '@prisma/client';
import { seedDemo } from './seedDemo.js';

const prisma = new PrismaClient();
try {
  const { email, password } = await seedDemo(prisma, { reset: process.argv.includes('--reset') });
  console.log(`Demo family ready. Log in with ${email} / ${password}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

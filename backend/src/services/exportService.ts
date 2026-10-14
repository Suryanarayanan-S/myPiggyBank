import { getFamily } from './familyService.js';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { formatDay, parseDay } from '../lib/dates.js';
import { ListQuery, filterWhere } from './transactionService.js';

const day = z.string().refine((s) => parseDay(s) !== null, 'Use a real date as YYYY-MM-DD');
export const ExportQuery = ListQuery.pick({
  type: true,
  accountId: true,
  categoryId: true,
  memberId: true,
  q: true,
}).extend({ from: day, to: day });

/** Byte-order mark so Excel opens the file as UTF-8. */
export const BOM = String.fromCharCode(0xfeff);

/** A text cell: neutralises spreadsheet formulas, then quotes when needed. */
export function cell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Signed amount with a decimal comma (how German spreadsheets read numbers). */
export const csvAmount = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export async function exportTransactionsCsv(
  prisma: PrismaClient,
  familyId: string,
  query: z.output<typeof ExportQuery>,
) {
  const BUCKET: Record<string, string> = (await getFamily(prisma, familyId)).bucketNames;
  const rows = await prisma.transaction.findMany({
    where: filterWhere(familyId, query),
    include: {
      account: { select: { name: true } },
      category: { select: { name: true, bucket: true } },
      member: { select: { name: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const header = 'Date;Type;Amount;Currency;Account;Category;Bucket;Member;Merchant;Notes;Tags';
  const lines = rows.map((t) =>
    [
      formatDay(t.date),
      t.type,
      csvAmount(t.type === 'income' ? Number(t.amount) : -Number(t.amount)),
      t.currency,
      cell(t.account?.name ?? ''),
      cell(t.category?.name ?? ''),
      cell(BUCKET[t.category?.bucket ?? ''] ?? ''),
      cell(t.member?.name ?? 'Shared'),
      cell(t.merchant ?? ''),
      cell(t.notes ?? ''),
      cell(t.tags.split(',').filter(Boolean).join(', ')),
    ].join(';'),
  );
  return `${BOM}${[header, ...lines].join('\r\n')}\r\n`;
}

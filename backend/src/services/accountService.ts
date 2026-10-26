import type { Account, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { CurrencySchema, sumConverted } from '../domain/currency.js';
import { getFamily } from './familyService.js';
import { loadRates } from './rateService.js';
import { computeBalances, type BalanceTxn } from '../domain/balances.js';
import { monthRange, todayLocal } from '../lib/dates.js';
import { AppError } from '../lib/errors.js';
import { assertAccount, assertMember } from './ownership.js';
import type { Db } from '../lib/db.js';

export const ACCOUNT_TYPES = [
  'current',
  'savings',
  'tagesgeld',
  'cash',
  'credit_card',
  'investment',
  'other',
] as const;
export const ASSET_CLASSES = ['liquid', 'property', 'investment', 'other'] as const;

const money = z.number().int('Amount must be in whole cents').refine(Number.isSafeInteger);

export const AccountCreate = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  type: z.enum(ACCOUNT_TYPES),
  currency: CurrencySchema,
  openingBalance: money.default(0),
  ownerMemberId: z.uuid().nullable().optional(),
  assetClass: z.enum(ASSET_CLASSES).optional(),
  archived: z.boolean().optional(),
});
export const AccountUpdate = AccountCreate.partial();

export type AccountDto = {
  id: string;
  name: string;
  type: string;
  currency: string;
  openingBalance: number;
  ownerMemberId: string | null;
  assetClass: string;
  archived: boolean;
  balance: number;
  monthChange: number;
};

/** A name is one person's once (each family member may have their own "Zerodha"). */
async function assertNameFree(
  prisma: PrismaClient,
  familyId: string,
  name: string,
  ownerMemberId: string | null,
  exceptId?: string,
) {
  const all = await prisma.account.findMany({
    where: { familyId, ownerMemberId },
    select: { id: true, name: true },
  });
  if (all.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(
      409,
      'ACCOUNT_EXISTS',
      ownerMemberId
        ? 'This person already has an account with this name'
        : 'A shared account with this name already exists',
    );
  }
}

const balanceSelect = {
  accountId: true,
  type: true,
  amount: true,
  transferAccountId: true,
  transferAmount: true,
  date: true,
} as const;

async function withBalances(prisma: PrismaClient, familyId: string, accounts: Account[]) {
  // Money columns are 64-bit (BigInt) in the DB; plain numbers are exact up to 2^53 minor units.
  const txns = (
    await prisma.transaction.findMany({ where: { familyId }, select: balanceSelect })
  ).map((t) => ({
    ...t,
    type: t.type as BalanceTxn['type'],
    amount: Number(t.amount),
    transferAmount: t.transferAmount === null ? null : Number(t.transferAmount),
  }));
  const { start, end } = monthRange(todayLocal().slice(0, 7));
  const opening = accounts.map((a) => ({ id: a.id, openingBalance: Number(a.openingBalance) }));
  const balances = computeBalances(opening, txns);
  const changes = computeBalances(
    accounts.map((a) => ({ id: a.id, openingBalance: 0 })),
    txns.filter((t) => t.date >= start && t.date < end),
  );
  return accounts.map((a): AccountDto => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    openingBalance: Number(a.openingBalance),
    ownerMemberId: a.ownerMemberId,
    assetClass: a.assetClass,
    archived: a.archived,
    balance: balances.get(a.id) ?? Number(a.openingBalance),
    monthChange: changes.get(a.id) ?? 0,
  }));
}

async function getDto(prisma: PrismaClient, familyId: string, id: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id } });
  return (await withBalances(prisma, familyId, [account]))[0]!;
}

export async function listAccounts(prisma: PrismaClient, familyId: string) {
  const accounts = await prisma.account.findMany({
    where: { familyId },
    orderBy: [{ archived: 'asc' }, { currency: 'asc' }, { name: 'asc' }],
  });
  return withBalances(prisma, familyId, accounts);
}

export async function createAccount(
  prisma: PrismaClient,
  familyId: string,
  input: z.output<typeof AccountCreate>,
) {
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  await assertNameFree(prisma, familyId, input.name, input.ownerMemberId ?? null);
  let created = '';
  await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        ...input,
        familyId,
        assetClass: input.assetClass ?? (input.type === 'investment' ? 'investment' : 'liquid'),
      },
    });
    created = account.id;
    // A person's first rupee demat takes their rupee holdings in none (a second one starts
    // empty: which broker they are with cannot be told; a euro broker's account is not a demat).
    if (account.type === 'investment' && account.currency === 'INR' && !account.archived) {
      const others = await tx.account.count({
        where: {
          familyId,
          ownerMemberId: account.ownerMemberId,
          type: 'investment',
          currency: 'INR',
          archived: false,
          NOT: { id: account.id },
        },
      });
      if (others === 0) {
        await moveLooseHoldings(tx, familyId, account.ownerMemberId, account.id);
      }
    }
  });
  return getDto(prisma, familyId, created);
}

/** A person's rupee holdings in no open demat (none, an account that is not one, a closed one). */
const LOOSE = [
  { accountId: null },
  { account: { type: { not: 'investment' } } },
  { account: { archived: true } },
];

/** Moves the person's rupee holdings in no open demat into this demat; how many. */
export async function moveLooseHoldings(
  db: Db,
  familyId: string,
  ownerMemberId: string | null,
  accountId: string,
) {
  const { count } = await db.holding.updateMany({
    where: { familyId, ownerMemberId, currency: 'INR', OR: LOOSE },
    data: { accountId },
  });
  return count;
}

const isUsed = (prisma: PrismaClient, id: string) =>
  prisma.transaction.count({ where: { OR: [{ accountId: id }, { transferAccountId: id }] } });

export async function updateAccount(
  prisma: PrismaClient,
  familyId: string,
  id: string,
  input: z.output<typeof AccountUpdate>,
) {
  const existing = await assertAccount(prisma, familyId, id);
  if (input.ownerMemberId) await assertMember(prisma, familyId, input.ownerMemberId);
  const name = input.name ?? existing.name;
  const owner = input.ownerMemberId !== undefined ? input.ownerMemberId : existing.ownerMemberId;
  // Only a new name or owner is checked: two shared accounts named alike (left by a deleted
  // member) can still be edited, archived or renamed apart.
  if (name.toLowerCase() !== existing.name.toLowerCase() || owner !== existing.ownerMemberId) {
    await assertNameFree(prisma, familyId, name, owner, id);
  }
  if (input.currency && input.currency !== existing.currency && (await isUsed(prisma, id))) {
    throw new AppError(
      400,
      'CURRENCY_LOCKED',
      'The currency cannot be changed once the account has transactions',
    );
  }
  // Its fixed deposits are in its currency.
  if (
    input.currency &&
    input.currency !== existing.currency &&
    (await prisma.deposit.count({ where: { accountId: id } }))
  ) {
    throw new AppError(
      400,
      'CURRENCY_LOCKED',
      'The currency cannot be changed while fixed deposits are linked to the account',
    );
  }
  await prisma.$transaction(async (tx) => {
    const a = await tx.account.update({ where: { id }, data: input });
    // A demat's holdings are its owner's: they follow a new owner.
    if (a.type === 'investment') {
      await tx.holding.updateMany({
        where: { accountId: id },
        data: { ownerMemberId: a.ownerMemberId },
      });
    }
  });
  return getDto(prisma, familyId, id);
}

export async function deleteAccount(prisma: PrismaClient, familyId: string, id: string) {
  await assertAccount(prisma, familyId, id);
  if (await isUsed(prisma, id)) {
    throw new AppError(
      409,
      'ACCOUNT_IN_USE',
      'This account has transactions. Archive it instead, or delete its transactions first.',
    );
  }
  await prisma.account.delete({ where: { id } });
}

/**
 * All open bank and cash accounts in one currency (default: the wealth currency), at the latest
 * rates. Demat accounts are left out: the Accounts page shows them apart, at what they hold.
 */
export async function accountsTotal(prisma: PrismaClient, familyId: string, view?: string) {
  const [family, accounts, rates] = await Promise.all([
    getFamily(prisma, familyId),
    listAccounts(prisma, familyId),
    loadRates(prisma, familyId),
  ]);
  const currency = view ?? family.wealthCurrency;
  const month = todayLocal().slice(0, 7);
  const items = accounts
    .filter((a) => !a.archived && a.type !== 'investment')
    .map((a) => ({ amount: a.balance, currency: a.currency, month }));
  return { currency, ...sumConverted(items, currency, rates) };
}

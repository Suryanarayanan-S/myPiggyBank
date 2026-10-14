import type { PrismaClient } from '@prisma/client';
import { addDays, monthRange, todayLocal } from '../lib/dates.js';
import { parse } from '../lib/validate.js';
import { AccountCreate, createAccount } from '../services/accountService.js';
import { RegisterInput, registerUser } from '../services/authService.js';
import { setLimits } from '../services/budgetService.js';
import { listCategories } from '../services/categoryService.js';
import { createMember } from '../services/memberService.js';
import { RateInput, upsertRate } from '../services/rateService.js';
import { RecurringCreate, createRecurring } from '../services/recurringService.js';
import { TransactionInput, createTransaction } from '../services/transactionService.js';
import {
  AssetCreate,
  BalanceInput,
  LiabilityCreate,
  SnapshotInput,
  ValuationInput,
  addBalance,
  addValuation,
  createAsset,
  createLiability,
  createSnapshot,
} from '../services/wealthService.js';

/** The demo login. Clearly fake, so it is never mistaken for a real family. */
export const DEMO = {
  email: 'demo@mypiggybank.local',
  password: 'demo-password-2026',
  name: 'Alex',
  familyName: 'Demo family (sample data)',
} as const;

/** Small deterministic random numbers, so every run gives the same demo. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const monthsBack = (today: string, n: number) => {
  const { start } = monthRange(today.slice(0, 7));
  start.setUTCMonth(start.getUTCMonth() - n);
  return start.toISOString().slice(0, 7);
};
const lastDay = (month: string) => addDays(monthRange(month).end.toISOString().slice(0, 10), -1);

/**
 * Creates a demo family with twelve months of EUR spending, some INR, a flat, gold, ETFs, a home
 * loan and net-worth history. Refuses if the demo family exists, unless `reset` (which deletes
 * only the demo family). Other families are never touched.
 */
export async function seedDemo(
  prisma: PrismaClient,
  opts: { reset?: boolean; today?: string } = {},
) {
  const today = opts.today ?? todayLocal();
  const existing = await prisma.user.findUnique({ where: { email: DEMO.email } });
  if (existing) {
    if (!opts.reset) throw new Error('The demo family already exists. Use --reset to recreate it.');
    await prisma.family.delete({ where: { id: existing.familyId } });
  }

  const user = await registerUser(prisma, parse(RegisterInput, { ...DEMO }));
  const fam = user.familyId;
  const rnd = random(2026);
  const vary = (cents: number, spread = 0.15) =>
    Math.round(cents * (1 - spread + rnd() * 2 * spread));

  const sam = await createMember(prisma, fam, 'Sam');
  await createMember(prisma, fam, 'Mia');
  const account = (input: object) => createAccount(prisma, fam, parse(AccountCreate, input));
  const giro = await account({
    name: 'Girokonto',
    type: 'current',
    currency: 'EUR',
    openingBalance: 250_000,
  });
  const tagesgeld = await account({
    name: 'Tagesgeld',
    type: 'tagesgeld',
    currency: 'EUR',
    openingBalance: 800_000,
  });
  const india = await account({
    name: 'India savings',
    type: 'savings',
    currency: 'INR',
    openingBalance: 30_000_000,
    ownerMemberId: sam.id,
  });

  const cats = await listCategories(prisma, fam);
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const txn = (input: object) => createTransaction(prisma, fam, parse(TransactionInput, input));

  const months = Array.from({ length: 12 }, (_, i) => monthsBack(today, 11 - i));
  for (const [i, month] of months.entries()) {
    // One EUR→INR rate per month, drifting a little.
    const rate = (96 + i * 0.35 + rnd()).toFixed(2);
    await upsertRate(prisma, fam, parse(RateInput, { month, base: 'EUR', quote: 'INR', rate }));

    const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
    const entries: [number, string, number, string, string?][] = [
      [1, 'income', 420_000, 'Salary'],
      [1, 'income', vary(180_000, 0.02), 'Salary', 'Sam'],
      [2, 'expense', 115_000, 'Rent'],
      [3, 'expense', 2_500, 'Phone'],
      [3, 'expense', 3_500, 'Internet'],
      [5, 'expense', vary(7_000), 'Electricity'],
      [5, 'expense', 12_000, 'Insurance'],
      [6, 'expense', vary(9_000), 'Transportation'],
      [8, 'expense', vary(21_000), 'Groceries'],
      [12, 'expense', vary(9_000, 0.5), 'Restaurants'],
      [15, 'expense', vary(12_000, 0.6), 'Shopping'],
      [18, 'expense', vary(20_000), 'Groceries'],
      [20, 'expense', vary(8_000, 0.6), 'Restaurants'],
      [22, 'expense', 3_000, 'Subscriptions'],
      [25, 'expense', 40_000, 'Stocks'],
      [25, 'expense', 15_000, 'ETF & Gold'],
      [26, 'expense', 20_000, 'Savings scheme'],
    ];
    if (i % 4 === 2) entries.push([14, 'expense', vary(90_000, 0.3), 'Travel']);
    if (i === 11 - 1) entries.push([28, 'income', 150_000, 'Bonus']);
    for (const [d, type, amount, category, who] of entries) {
      if (day(d) > today) continue;
      await txn({
        date: day(d),
        amount,
        type,
        accountId: giro.id,
        categoryId: cat(category),
        memberId: who === 'Sam' ? sam.id : null,
        merchant: category === 'Groceries' ? 'REWE' : null,
      });
    }
    // Family support paid from the INR account.
    if (day(10) <= today) {
      await txn({
        date: day(10),
        amount: 1_500_000,
        type: 'expense',
        accountId: india.id,
        categoryId: cat('Gifts'),
        memberId: sam.id,
        merchant: 'Family support',
      });
    }
    if (day(27) <= today) {
      await txn({
        date: day(27),
        amount: 30_000,
        type: 'transfer',
        accountId: giro.id,
        transferAccountId: tagesgeld.id,
        notes: 'Monthly saving',
      });
    }
  }

  const current = today.slice(0, 7);
  await setLimits(prisma, fam, current, {
    limits: [
      { categoryId: cat('Groceries'), amount: 45_000 },
      { categoryId: cat('Restaurants'), amount: 20_000 },
    ],
  });
  await createRecurring(
    prisma,
    fam,
    parse(RecurringCreate, {
      name: 'Streaming',
      type: 'expense',
      amount: 1_399,
      accountId: giro.id,
      categoryId: cat('Subscriptions'),
      frequency: 'monthly',
      startDate: `${monthsBack(today, -1)}-15`,
    }),
  );

  // Wealth in INR: a flat, gold, an ETF depot in EUR, and a home loan paid down monthly.
  const first = months[0]!;
  const flat = await createAsset(
    prisma,
    fam,
    parse(AssetCreate, {
      name: 'Flat in Chennai',
      assetClass: 'property',
      currency: 'INR',
      value: 620_000_000,
      date: `${first}-01`,
    }),
  );
  await addValuation(
    prisma,
    fam,
    flat.id,
    parse(ValuationInput, { date: `${months[6]}-01`, value: 650_000_000 }),
  );
  await createAsset(
    prisma,
    fam,
    parse(AssetCreate, {
      name: 'Gold',
      assetClass: 'other',
      currency: 'INR',
      value: 45_000_000,
      date: `${first}-01`,
    }),
  );
  await createAsset(
    prisma,
    fam,
    parse(AssetCreate, {
      name: 'ETF depot',
      assetClass: 'investment',
      currency: 'EUR',
      value: 1_500_000,
      date: `${first}-01`,
    }),
  );
  const loan = await createLiability(
    prisma,
    fam,
    parse(LiabilityCreate, {
      name: 'Home loan',
      type: 'mortgage',
      currency: 'INR',
      originalAmount: 400_000_000,
      interestRate: '8.4',
      monthlyPayment: 3_500_000,
      lender: 'Demo Bank',
      outstanding: 320_000_000,
      date: `${first}-01`,
    }),
  );
  for (const [i, month] of months.slice(1).entries()) {
    await addBalance(
      prisma,
      fam,
      loan.id,
      parse(BalanceInput, { date: `${month}-01`, outstanding: 320_000_000 - (i + 1) * 1_200_000 }),
    );
  }

  // A year of net-worth history (past entries), then today's snapshot.
  for (const [i, month] of months.slice(0, -1).entries()) {
    await createSnapshot(
      prisma,
      fam,
      parse(SnapshotInput, {
        date: lastDay(month),
        netWorth: 450_000_000 + i * 6_000_000,
        note: i === 0 ? 'Started tracking' : null,
      }),
    );
  }
  await createSnapshot(prisma, fam, parse(SnapshotInput, { note: 'Demo snapshot' }));
  return { email: DEMO.email, password: DEMO.password, familyId: fam };
}

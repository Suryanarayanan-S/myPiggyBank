export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  familyId: string;
  memberId: string | null;
};
export type Family = {
  id: string;
  name: string;
  spendingCurrency: string;
  wealthCurrency: string;
};
export type Me = { user: AuthUser; family: Family };
export type Member = { id: string; name: string; isUser: boolean };

export const CURRENCIES = ['EUR', 'INR', 'USD', 'GBP'] as const;

export const ACCOUNT_TYPES = {
  current: 'Current account',
  savings: 'Savings',
  tagesgeld: 'Tagesgeld',
  cash: 'Cash',
  credit_card: 'Credit card',
  investment: 'Investment',
  other: 'Other',
} as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;

export const ASSET_CLASSES = {
  liquid: 'Liquid funds',
  property: 'Property',
  investment: 'Investments',
  other: 'Other',
} as const;

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  ownerMemberId: string | null;
  assetClass: keyof typeof ASSET_CLASSES;
  archived: boolean;
  balance: number;
  monthChange: number;
};

export const BUCKETS = { essentials: 'Essentials', fun: 'Fun', future: 'Future You' } as const;
export type Bucket = keyof typeof BUCKETS;

export type Category = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  bucket: Bucket | null;
  sortOrder: number;
};

export type TransactionType = 'income' | 'expense' | 'transfer';
export type Transaction = {
  id: string;
  date: string;
  amount: number;
  currency: string;
  type: TransactionType;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  bucket: Bucket | null;
  memberId: string | null;
  memberName: string | null;
  merchant: string | null;
  notes: string | null;
  tags: string[];
  transferAccountId: string | null;
  transferAccountName: string | null;
  transferAmount: number | null;
  transferCurrency: string | null;
};
export type CurrencyTotals = { currency: string; income: number; expense: number };
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totals: CurrencyTotals[];
};

export type Rate = { id: string; month: string; base: string; quote: string; rate: string };

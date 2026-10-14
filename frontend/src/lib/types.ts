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
  rateMode: 'manual' | 'live';
  targets: { essentials: number; fun: number; future: number };
  bucketNames: Record<Bucket, string>;
};
export type Me = { user: AuthUser; family: Family };
export type Member = { id: string; name: string; isUser: boolean };

export const CURRENCIES = ['EUR', 'INR', 'USD', 'GBP', 'CHF', 'AUD', 'CAD', 'SGD'] as const;
export type Currency = (typeof CURRENCIES)[number];

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

/** Bucket keys in display order; their names come from the family (`useBucketNames`). */
export const BUCKET_KEYS = ['essentials', 'fun', 'future'] as const;
export type Bucket = (typeof BUCKET_KEYS)[number];

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
  accountId: string | null;
  accountName: string | null;
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
  isMonthlyTotal: boolean;
};
export type CurrencyTotals = { currency: string; income: number; expense: number };
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totals: CurrencyTotals[];
  /** The same totals in one currency (present when the request named one). */
  converted: {
    currency: string;
    income: number;
    expense: number;
    unconverted: { currency: string; amount: number }[];
  } | null;
};

export type Rate = { id: string; month: string; base: string; quote: string; rate: string };

export type BucketSummary = {
  bucket: Bucket;
  targetPct: number;
  target: number;
  actual: number;
  actualBp: number | null;
  status: 'ok' | 'over' | 'under';
};
export type CategorySummary = {
  categoryId: string | null;
  name: string;
  kind: 'income' | 'expense';
  bucket: Bucket | null;
  actual: number;
  limit: number | null;
  remaining: number | null;
  usedBp: number | null;
  over: boolean;
};
export type MonthSummary = {
  month: string;
  currency: string;
  netIncome: number;
  essentials: number;
  fun: number;
  future: number;
  uncategorised: number;
  spent: number;
  unused: number;
  savingsRateBp: number | null;
  buckets: BucketSummary[];
  categories: CategorySummary[];
  unconverted: { currency: string; amount: number }[];
  /** Limits are stored in the spending currency; in another view currency they are read-only. */
  limitsEditable: boolean;
  /** Limits that have no exchange rate into the view currency, in their own currency. */
  unconvertedLimits: { categoryId: string; amount: number; currency: string }[];
};
export type MonthEntry = {
  month: string;
  accountId: string;
  currency: string;
  rows: {
    categoryId: string;
    name: string;
    kind: 'income' | 'expense';
    bucket: Bucket | null;
    amount: number | null;
    otherTransactions: number;
  }[];
};

export type ImportSuggestion = { categoryId: string } | { newName: string };
export type ImportMonth = {
  sheet: string;
  month: string;
  income: { label: string; amount: number }[];
  items: { bucket: Bucket; label: string; amount: number }[];
  sheetTotals: { netIncome: number | null; spend: number | null };
  parsedTotals: { netIncome: number; spend: number };
  matches: boolean;
  warnings: string[];
  existing: { imported: number; manual: number };
};
export type ImportLabel = {
  key: string;
  kind: 'income' | 'expense';
  bucket: Bucket | null;
  label: string;
  occurrences: number;
  total: number;
  suggestion: ImportSuggestion;
};
export type ImportPreview = {
  months: ImportMonth[];
  labels: ImportLabel[];
  skippedSheets: string[];
};
export type ImportResult = {
  created: number;
  months: string[];
  newCategories: string[];
  accountId: string;
};

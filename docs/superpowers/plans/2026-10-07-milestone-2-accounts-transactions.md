# Milestone 2 — Accounts, Categories, Transactions, Currencies & Account Deletion

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (chosen: native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Record real money: accounts (EUR and INR), categories in 50/30/20 buckets, income/expense/transfer transactions with search/filter/sort, monthly EUR↔INR rates, family currency settings, and "delete my account".

**Architecture:** Same layering as M1: `routes/` (HTTP + zod) → `services/` (Prisma, family-scoped) → pure `domain/` functions (balances, currency) unit-tested without a DB. Frontend adds Accounts and Transactions pages and Settings cards. Playwright is introduced for a browser smoke test and screenshots (first real visual check).

**Tech Stack:** as M1, plus Playwright (Chromium) for E2E.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` (Revision 1.1 governs).

**Plan style note:** M1's plan carried full implementation code. Because this plan is executed inline by its author, M2 specifies exact data model, interfaces, API contracts and the test cases (names + assertions); implementation code is written test-first during execution.

## Global Constraints

- All M1 constraints still apply (family scoping ⇒ 404 for foreign ids, `{data}`/`{error}` shapes, CSRF origin check, argon2id, UUIDs, strict TS).
- Money = integer minor units (cents/paise) + ISO currency. Supported currencies: `EUR`, `INR`, `USD`, `GBP`.
- Exchange rates stored as integer micros (`rateMicros = round(rate × 1_000_000)`), API exposes them as decimal strings (`"97.85"`).
- A transaction's currency is its account's currency (no per-transaction override in M2).
- Dates are calendar dates `YYYY-MM-DD` (API), stored as UTC midnight `DateTime`.
- Data never leaves the laptop; spreadsheets are not committed.

## Review Focus

1. A transaction referencing another family's account / category / member (or a transfer to another family's account) must be rejected (404) and nothing written — test in Task 4.
2. A category's kind must match the transaction type (income category on an expense ⇒ 400) — test in Task 4.
3. Transfers between accounts with different currencies require `transferAmount`; same-currency transfers default it to `amount`; balances move on both sides — tests in Tasks 2 and 4.
4. Deleting an account/category that is still used must be refused (409) rather than silently orphaning or cascading transactions — tests in Tasks 3 and 4.
5. Account deletion: wrong password or missing "DELETE" confirmation ⇒ nothing deleted; sole login ⇒ entire family's data gone; afterwards the old session cookie is invalid — test in Task 6.

---

## Data model changes (Prisma, one migration `m2_money`)

```prisma
model Family {
  // baseCurrency RENAMED to spendingCurrency (hand-edited migration: ALTER TABLE … RENAME COLUMN)
  spendingCurrency String @default("EUR")
  wealthCurrency   String @default("INR")
  accounts      Account[]
  categories    Category[]
  transactions  Transaction[]
  exchangeRates ExchangeRate[]
}

model ExchangeRate {
  id String @id @default(uuid())
  familyId String  (Cascade)
  month String      // "YYYY-MM"
  base  String      // e.g. EUR
  quote String      // e.g. INR
  rateMicros Int    // 1 base = rateMicros/1e6 quote
  createdAt/updatedAt
  @@unique([familyId, month, base, quote])
}

model Account {
  id, familyId (Cascade), name, type String  // current|savings|tagesgeld|cash|credit_card|investment|other
  currency String, openingBalance Int @default(0)
  ownerMemberId String? (FamilyMember, SetNull)   // null = shared
  assetClass String @default("liquid")           // liquid|property|investment|other (used in M6)
  archived Boolean @default(false)
  createdAt/updatedAt
  @@unique([familyId, name]) @@index([familyId])
}

model Category {
  id, familyId (Cascade), name, kind String  // income|expense
  bucket String?   // essentials|fun|future — required for expense, null for income
  sortOrder Int @default(0)
  createdAt/updatedAt
  @@unique([familyId, kind, name])
}

model Transaction {
  id, familyId (Cascade), accountId (Account, Cascade), date DateTime
  amount Int        // > 0, in account currency
  type String       // income|expense|transfer
  categoryId String? (SetNull), memberId String? (FamilyMember, SetNull)
  merchant String?, notes String?, tags String @default("")   // stored ",tag1,tag2," lower-case
  transferAccountId String? (Account "TransferIn", Cascade), transferAmount Int?
  createdAt/updatedAt
  @@index([familyId, date]) @@index([accountId, date]) @@index([familyId, categoryId])
}
```

Ruling (pre-made): subcategories (`parentId`) dropped from M2 — the user's sheets have none; add later if needed.

Default categories (seeded on register, and lazily for existing families when they have none):

- income: Salary, Bonus, Other income, Tax refund, Interest, Dividends
- essentials: Rent, Groceries, Transportation, Phone, Electricity, Internet, Insurance, Tax, Bank fees, Health
- fun: Restaurants, Shopping, Subscriptions, Entertainment, Travel, Gifts
- future: Recurring deposit, Stocks, ETF & Gold, Savings scheme, Pension

---

### Task 1: Schema migration + family currency settings

**Files:** `backend/prisma/schema.prisma`, new migration, `backend/src/domain/currency.ts` (constants only here), `backend/src/services/familyService.ts`, `backend/src/routes/family.ts`, `backend/src/app.ts`, `backend/src/routes/auth.ts` (me), `backend/test/family.test.ts`, `backend/test/auth.test.ts` (baseCurrency→spendingCurrency), frontend `lib/types.ts`, `SettingsPage.tsx`.

**Interfaces:** `CURRENCIES = ['EUR','INR','USD','GBP'] as const`, `Currency` type, `CurrencySchema` (zod enum). `GET /api/family` → `{data:{id,name,spendingCurrency,wealthCurrency}}`; `PUT /api/family {name?, spendingCurrency?, wealthCurrency?}` → same. `/auth/me` family object gains both currency fields (no `baseCurrency`).

Tests (`family.test.ts`):

- new family defaults: spendingCurrency EUR, wealthCurrency INR (via /me and GET /family)
- PUT updates name + currencies; unsupported currency `"JPY"` ⇒ 400 VALIDATION_ERROR
- unauthenticated ⇒ 401
  Migration must preserve existing rows (rename column, not drop) — verify existing `data/dev.db` user still logs in after migrate.

### Task 2: Domain — currency conversion and account balances (pure)

**Files:** `backend/src/domain/currency.ts`, `backend/src/domain/balances.ts`, `backend/test/domain/currency.test.ts`, `backend/test/domain/balances.test.ts`.

**Interfaces:**

- `parseRate(s: string): number | null` → micros (accepts "97.85", "97,85"; > 0; ≤ 6 decimals)
- `formatRate(micros: number): string` ("97.85")
- `type Rate = { month: string; base: string; quote: string; rateMicros: number }`
- `findRate(rates: Rate[], month: string, from: string, to: string): number | null` — micros for 1 `from` in `to`; exact month, else latest earlier month; uses inverse pair (1e12 / micros) if only reverse stored; `from===to` ⇒ 1_000_000; none ⇒ null
- `convert(cents: number, from: string, to: string, month: string, rates: Rate[]): number | null` — rounds half away from zero
- `type BalanceTxn = { accountId: string; type: 'income'|'expense'|'transfer'; amount: number; transferAccountId: string | null; transferAmount: number | null }`
- `computeBalances(accounts: {id: string; openingBalance: number}[], txns: BalanceTxn[]): Map<string, number>` — income +amount; expense −amount; transfer: source −amount, destination +(transferAmount ?? amount)

Tests: same-currency identity; exact-month rate; fallback to earlier month; no future-month leakage (a rate for 2026-11 is not used for 2026-10); inverse pair; null when no rate; rounding (1 EUR=97.855 → 100 cents → 9786 paise); parseRate accepts comma, rejects "0", "-1", "abc", "1.1234567"; balances with income/expense/opening; transfer same currency; transfer cross-currency uses transferAmount on destination.

### Task 3: Accounts + categories API

**Files:** `backend/src/services/{accountService,categoryService}.ts`, `backend/src/routes/{accounts,categories}.ts`, `backend/src/services/authService.ts` (seed categories on register), `backend/test/{accounts,categories}.test.ts`.

**Interfaces:**

- `AccountDto = { id, name, type, currency, openingBalance, ownerMemberId: string|null, assetClass, archived, balance: number, monthChange: number }` (balance/monthChange in account currency; monthChange = net movement in the current calendar month)
- `POST /api/accounts {name, type, currency, openingBalance?=0, ownerMemberId?, assetClass?, archived?}`; `PUT /api/accounts/:id` (partial; currency change refused with 400 if transactions exist); `DELETE` ⇒ 409 `ACCOUNT_IN_USE` if any transaction references it (either side), else 200.
- `CategoryDto = { id, name, kind, bucket: 'essentials'|'fun'|'future'|null, sortOrder }`; `GET /api/categories` (seeds defaults if the family has none) ordered kind, bucket, sortOrder, name; `POST {name, kind, bucket?}` (expense requires bucket, income forbids it ⇒ 400); `PUT` (name/bucket/sortOrder; kind immutable); `DELETE` ⇒ 409 `CATEGORY_IN_USE` if used.
- `seedDefaultCategories(tx, familyId)` exported from categoryService, called inside register transaction.
- Names unique per family (accounts) / per family+kind (categories), case-insensitive ⇒ 409 `ACCOUNT_EXISTS` / `CATEGORY_EXISTS`.

Tests: register seeds 27 categories with correct buckets; CRUD happy paths; validation (bad type/currency/bucket rules); ownerMemberId from another family ⇒ 404; duplicate names ⇒ 409; family isolation (GET/PUT/DELETE other family's ids ⇒ 404); balance reflects opening balance (transactions added in Task 4 tests).

### Task 4: Transactions API (CRUD, list, filters)

**Files:** `backend/src/services/transactionService.ts`, `backend/src/routes/transactions.ts`, `backend/test/transactions.test.ts`.

**Interfaces:**

- Input: `{ date: 'YYYY-MM-DD', amount: number (int cents > 0), type, accountId, categoryId?, memberId?, merchant?, notes?, tags?: string[], transferAccountId?, transferAmount? }`
- Rules: income/expense ⇒ `categoryId` optional but if given must be same family and `kind` matching type; transfer ⇒ `transferAccountId` required, ≠ accountId, no category; `transferAmount` required when the two accounts' currencies differ, defaults to `amount` otherwise; member must be same family; tags trimmed, lower-cased, deduped, max 10 × 30 chars.
- `TransactionDto = { id, date, amount, currency, type, accountId, accountName, categoryId, categoryName, bucket, memberId, memberName, merchant, notes, tags: string[], transferAccountId, transferAccountName, transferAmount, transferCurrency }`
- `GET /api/transactions?from&to&type&accountId&categoryId&memberId(uuid|'shared')&q&sort=date|amount&order=asc|desc&page=1&pageSize=50(max 200)` ⇒ `{data:{items, total, page, pageSize}}`; `from`/`to` inclusive dates; `q` matches merchant, notes, tags, category name (case-insensitive); default sort date desc then createdAt desc.
- `POST` ⇒ 201; `PUT /:id` full replace (same validation); `DELETE /:id`.

Tests: create income/expense/transfer and balances update (GET /accounts); cross-currency transfer needs transferAmount (400 without); same-currency transfer defaults; category kind mismatch ⇒ 400; foreign account/category/member/transferAccount ⇒ 404 and no row written; filters (date range, type, account incl. transfer destination, category, member + 'shared', q on merchant/notes/tags/category); sort by amount asc; pagination total; edit changes balance; delete; account/category delete now 409 when in use; amount 0 / negative / non-integer ⇒ 400; invalid date `2026-02-30` ⇒ 400.

### Task 5: Exchange rates API

**Files:** `backend/src/services/rateService.ts`, `backend/src/routes/rates.ts`, `backend/test/rates.test.ts`.

**Interfaces:** `RateDto = { id, month, base, quote, rate: string }`; `GET /api/exchange-rates` (month desc); `PUT /api/exchange-rates {month:'YYYY-MM', base, quote, rate:'97.85'}` upsert ⇒ 200; `DELETE /api/exchange-rates/:id`. base ≠ quote; currencies supported; month valid.

Tests: upsert creates then updates same month/pair; invalid rate/month/base==quote ⇒ 400; isolation 404; list order.

### Task 6: Delete my account

**Files:** `backend/src/services/authService.ts` (`deleteAccount`), `backend/src/routes/auth.ts`, `backend/test/account-deletion.test.ts`.

**Interfaces:** `DELETE /api/auth/account` body `{ password: string, confirm: 'DELETE' }` ⇒ 200 `{data:{ok:true, familyDeleted: boolean}}`, clears cookie. Wrong password ⇒ 401 `INVALID_CREDENTIALS`; confirm ≠ "DELETE" ⇒ 400. Sole login ⇒ delete Family (cascade everything). Other logins exist ⇒ delete only the User (their member row stays, unlinked).

Tests: wrong password ⇒ nothing deleted; missing confirm ⇒ 400; success ⇒ family, accounts, categories, transactions, members, sessions all gone, old cookie ⇒ 401, email can register again; multi-user family (second user inserted directly via Prisma) ⇒ only that user removed, family and data stay; another family untouched.

### Task 7: Frontend — money formatting, Accounts page, Settings cards

**Files:** `frontend/src/lib/money.ts` (+tests), `lib/types.ts`, `layout/nav.ts`, `App.tsx`, `pages/AccountsPage.tsx`, `pages/SettingsPage.tsx` (+ `components/settings/{FamilyCard,CategoriesCard,RatesCard,DangerZoneCard}.tsx`), `components/ui/{Select,Modal}.tsx`.

**Interfaces:** `formatMoney(cents, currency)` picks locale by currency (EUR de-DE, INR en-IN, USD en-US, GBP en-GB) unless locale passed; `formatCompact(cents, currency)` ⇒ INR `₹80 L` / `₹1.2 Cr`, others `€128.5k`.

Tests (money.test.ts): `formatMoney(800000000,'INR')` ⇒ `₹80,00,000.00`; `formatCompact(800000000,'INR')` ⇒ `₹80 L`; `formatCompact(1200000000,'INR')` ⇒ `₹1.2 Cr`; `formatCompact(12845000,'EUR')` ⇒ `€128.5k`; existing EUR cases unchanged.

UI: Accounts page — grouped by currency, card per account (name, type, owner, balance, month change coloured +/−), add/edit modal (name, type, currency, opening balance via parseMoneyInput, owner, archived), delete with 409 message. Settings — Family card editable (name, spending & wealth currency), Categories card (income + three bucket columns, add/rename/move bucket/delete), Exchange rates card (month, pair, rate list + add), Danger zone (password + type DELETE).

### Task 8: Frontend — Transactions page

**Files:** `pages/TransactionsPage.tsx`, `components/transactions/{TransactionForm,TransactionFilters,TransactionList}.tsx`.

UI: month selector (default current month) + filters (type, account, category, member incl. Shared, search) synced to URL query; desktop table / mobile list with date, merchant/notes, category + bucket badge, member, account, amount coloured (income green, expense default, transfer neutral) in account currency; per-currency totals for the filtered set (income, expense); add/edit modal: type tabs, date, amount, account, category (filtered by kind, grouped by bucket), member (incl. Shared), merchant, notes, tags (comma separated), transfer: destination account + amount in destination currency when currencies differ; delete with confirm; pagination.

### Task 9: Playwright browser smoke + screenshots

**Files:** `e2e/playwright.config.ts`, `e2e/smoke.spec.ts`, root `package.json` (`"e2e": "playwright test -c e2e"`), `.gitignore` (test-results, playwright-report).

Flow: register → Settings shows EUR/INR → add account "Sparkasse" (EUR, €1,000.00 opening) → add income 5416 Salary → add expense 52,40 REWE Groceries → Transactions shows both and totals → Accounts shows balance €6.363,60 → delete account (Danger zone) → back at login. Runs against `npm run build && npm start` on a throw-away DB (`DATABASE_URL=file:…/e2e.db`, port 3101). Screenshots (desktop 1280×800 + mobile 390×844, light + dark) saved to `e2e/screenshots/` (git-ignored) for visual review.

---

## Completion

`npm run check` green, `npm run e2e` green, `./scripts/docker-smoke.sh` green, rebuild running Docker instance (migration applies to real `data/piggybank.db` without data loss), commit per task, final review, report.

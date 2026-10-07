# Milestone 3 — 50/30/20 Budget & Month Quick-Entry Grid

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the monthly spreadsheet: a Budget page showing net income, Essentials / Fun / Future You (target % vs actual %), unused amount and savings rate in the spending currency, optional per-category monthly limits with warnings, and a quick-entry grid to type one total per category per month.

**Architecture:** One pure domain function `summarizeMonth` does all money math (conversion via monthly rates, buckets, limits) and is unit-tested exhaustively; services only load rows. Monthly totals are ordinary transactions flagged `isMonthlyTotal`, so every other feature (lists, balances, search) sees them.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` — Revision 1.1 §2 (buckets, money math) and §3 (month grid).

**Plan style:** as M2 — exact model, interfaces, contracts and test cases; code written test-first during execution.

## Global Constraints

- All M1/M2 constraints apply (family scoping ⇒ 404, `{data}`/`{error}`, CSRF, BigInt money columns ⇒ numbers in DTOs).
- Money math per spec Rev 1.1 §2, in the family's `spendingCurrency`:
  `netIncome = Σ income`; `essentials`, `fun`, `future` = Σ expenses by bucket; `uncategorised` = Σ expenses without category;
  `spent = essentials + fun + uncategorised`; `unused = netIncome − spent − future`;
  `savingsRate = (future + unused) / netIncome` (null when netIncome = 0). Transfers never count.
- Conversion uses `convert()` with the month's rate (fallback: latest earlier month). Amounts with no rate are **excluded and reported** in `unconverted` (per currency) — never silently treated as 1:1.
- Bucket targets are whole percents, each 0–100, summing to exactly 100 (default 50/30/20).
- Rounding: bucket targets in cents = round(netIncome × pct / 100); percentages returned as basis points (integer, 1 bp = 0.01 %).

## Review Focus

1. INR transactions in a EUR-spending month with no rate at all must not be added 1:1 — they appear in `unconverted` and the UI warns — test in Task 1.
2. A category limit for another family's category, or a quick-entry row for another family's account/category, must 404 with nothing written — tests in Tasks 3 and 4.
3. Quick entry is idempotent: saving the same grid twice leaves exactly one monthly-total transaction per (month, account, category); clearing a value deletes it; individual transactions are never touched — test in Task 4.
4. Bucket targets not summing to 100 ⇒ 400 — test in Task 2.
5. A month with income but zero expenses, and a month with expenses but zero income (savings rate null, unused negative) render correct numbers — tests in Task 1.

---

## Data model (migration `m3_budget`)

```prisma
model Family {
  targetEssentials Int @default(50)
  targetFun        Int @default(30)
  targetFuture     Int @default(20)
  categoryLimits   CategoryLimit[]
}
model Category { limits CategoryLimit[] }
model Transaction {
  isMonthlyTotal Boolean @default(false)
  @@index([familyId, isMonthlyTotal, date])
}
model CategoryLimit {
  id String @id @default(uuid())
  familyId String (Cascade)
  categoryId String (Category, Cascade)
  month String          // YYYY-MM
  amount BigInt         // spending currency, minor units, > 0
  createdAt/updatedAt
  @@unique([familyId, month, categoryId])
}
```

Ruling (pre-made): budget rollover and annual budgets are not in M3 (not in the user's sheets); copy-previous-month covers the recurring case.

### Task 1: Domain — `summarizeMonth` (pure)

**Files:** `backend/src/domain/budget.ts`, `backend/test/domain/budget.test.ts`.

**Interface:**

```ts
type SummaryTxn = { type: 'income'|'expense'|'transfer'; amount: number; currency: string;
  categoryId: string|null; categoryName: string|null; bucket: Bucket|null; isMonthlyTotal: boolean };
type Targets = { essentials: number; fun: number; future: number };   // percents
summarizeMonth(input: { month: string; currency: string; txns: SummaryTxn[]; rates: Rate[];
  targets: Targets; limits: { categoryId: string; amount: number }[];
  categories: { id: string; name: string; kind: string; bucket: Bucket|null }[] }): MonthSummary
MonthSummary = {
  month, currency, netIncome, essentials, fun, future, uncategorised, spent, unused,
  savingsRateBp: number|null,
  buckets: { bucket, targetPct, target, actual, actualBp: number|null, status: 'ok'|'over'|'under' }[],
     // status: essentials/fun 'over' when actual > target; future 'under' when actual < target; else 'ok'
  categories: { categoryId, name, kind, bucket, actual, limit: number|null, remaining: number|null,
                usedBp: number|null, over: boolean }[],   // every category of the family (+ an "Uncategorised" row when > 0), income first
  unconverted: { currency: string; amount: number }[],
}
```

Tests: user's real Sep-26 shape (salary 3750 + tax refund 2000 = 5750; rent 912, transport 63, phone 20, electricity 41, wifi 45, tax return 60, insurance 58+4, bank 5 → essentials 1208; fun 172; future 580 ⇒ spent 1380, unused 3790, savings rate (580+3790)/5750 = 76.00 % → 7600 bp; actualBp essentials 2101 (rounded)); INR expense converted with the month's rate; fallback to an earlier month's rate; no rate ⇒ in `unconverted`, excluded from totals; transfers ignored; uncategorised expense counted in spent and listed; zero income ⇒ savingsRateBp null, actualBp null; limits: remaining/usedBp/over; categories without transactions still listed with actual 0; bucket status rules.

### Task 2: Bucket targets on the family

**Files:** schema + migration, `familyService.ts` (+ `targets` in DTO), `backend/test/family.test.ts`, frontend `lib/types.ts`.

**Contract:** `GET/PUT /api/family` DTO gains `targets: { essentials, fun, future }`; PUT accepts `targets` (all three, ints 0–100, sum 100 ⇒ else 400 `VALIDATION_ERROR` path `targets`). `/auth/me` family includes `targets`.

Tests: defaults 50/30/20; update 60/25/15; sum 99 ⇒ 400; negative ⇒ 400.

### Task 3: Budget API (summary + limits)

**Files:** `backend/src/services/budgetService.ts`, `backend/src/routes/budget.ts`, `backend/test/budget.test.ts`.

**Contract:**

- `GET /api/budget/:month` (`YYYY-MM`) ⇒ `{ data: MonthSummary }` built from the family's transactions dated in that month, all rates, family targets/currency, that month's limits and categories.
- `PUT /api/budget/:month/limits { limits: [{ categoryId, amount: number|null }] }` ⇒ upsert (amount > 0) / delete (null); expense categories only (income ⇒ 400); foreign category ⇒ 404, nothing written (validate all before writing, single DB transaction). Returns the new summary.
- `POST /api/budget/:month/copy-previous` ⇒ replaces this month's limits with the previous month's; 404-free: if previous month has none ⇒ 409 `NO_PREVIOUS_LIMITS`. Returns the new summary.

Tests: summary end-to-end through HTTP with EUR + INR account and a rate; limits set/update/clear; income-category limit ⇒ 400; foreign category ⇒ 404 and no rows; copy-previous copies and replaces; copy with nothing ⇒ 409; bad month ⇒ 400; isolation (other family sees empty summary, cannot touch limits).

### Task 4: Month quick entry API

**Files:** `backend/src/services/monthEntryService.ts`, `backend/src/routes/monthEntry.ts`, `backend/test/month-entry.test.ts`.

**Contract:**

- `GET /api/month-entry/:month?accountId=` ⇒ `{ data: { month, accountId, currency, rows: [{ categoryId, name, kind, bucket, amount: number|null /* this account's monthly total */, otherTransactions: number /* count of individual txns in this category & month, any account */ }] } }` — rows for all categories, income first then buckets.
- `PUT /api/month-entry/:month { accountId, entries: [{ categoryId, amount: number|null }] }` ⇒ for each entry: amount > 0 ⇒ upsert the single monthly-total transaction (date = first day of month, type = category kind, merchant null, notes "Monthly total"); null ⇒ delete it. All references validated first (foreign ⇒ 404, nothing written), applied in one DB transaction. Returns the GET payload.
- Monthly-total transactions show in lists with `isMonthlyTotal: true` (TransactionDto gains the field).

Tests: save grid ⇒ transactions created with right type/date/amount; save again with changed values ⇒ updated, still one per category; null ⇒ deleted; individual transactions untouched; budget summary includes monthly totals; foreign account/category ⇒ 404 and nothing written; archived account allowed? ⇒ no: 400 `ACCOUNT_ARCHIVED`; GET reports amounts per account.

### Task 5: Frontend — Budget page

**Files:** `frontend/src/pages/BudgetPage.tsx`, `components/budget/{SummaryCards,BucketBars,CategoryLimits,TargetsForm}.tsx`, `components/ui/Progress.tsx`, `lib/percent.ts` (+test), `layout/nav.ts`, `App.tsx`.

UI: month navigation (shared helper with Transactions: move month helpers to `lib/months.ts` + tests: `shiftMonth`, `monthTitle`, `localMonth()`, `localDay()` — local time, fixing the M2 UTC minor); summary cards (Net income, Spent, Future You, Unused, Savings rate); three bucket bars with target marker, actual %, amount vs target, colours (ok slate/emerald, over rose, future under amber) and plain-language hint ("Fun is €40 over its 30 % target"); unconverted warning linking to Settings; category table grouped by bucket with actual, editable limit, remaining, progress, over warning; "Copy last month's limits"; "Edit targets" (three number inputs, live sum); "Quick entry" button → `/budget/entry?month=`.
`formatPercent(bp)` ⇒ `"21.0 %"`; tests.

### Task 6: Frontend — Quick entry grid

**Files:** `frontend/src/pages/MonthEntryPage.tsx`.

UI: month nav; account picker (non-archived; default: first account in spending currency); four groups (Income, Essentials, Fun, Future You) of rows: category name, amount input (parseMoneyInput, Indian/European formats), hint "+ N individual transactions"; live group subtotals and Net income / Spent / Unused preview; "Save month" (sends only changed rows; empty input ⇒ null); success toast and link back to Budget; unsaved-changes guard on month/account switch.

### Task 7: E2E + screenshots

Extend `e2e/smoke.spec.ts` (or new `budget.spec.ts`): register → add EUR account → Quick entry for the current month: Salary 3750, Tax refund 2000, Rent 912, Groceries 300, Restaurants 172, Stocks 580 → Budget shows net income 5.750,00 €, unused, savings rate, bucket % → set Groceries limit 250 ⇒ over warning visible → screenshots desktop/mobile, light/dark. Layout assertions for the grid inputs (width > 100 px).

## Completion

`npm run check`, `npm run e2e`, `./scripts/docker-smoke.sh` green; back up real DB, rebuild Docker; final review; fixes; report.

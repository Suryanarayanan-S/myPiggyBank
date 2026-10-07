# Milestone 4 — Monthly-Spending Spreadsheet Importer

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the user's `Monthly Spending.xlsx` history (one sheet per month, Nov 2023 → Oct 2026) into myPiggyBank with upload → preview → category mapping → per-month checks against the sheet's own totals → duplicate handling → confirm. Nothing is written before confirm.

**Architecture:** Pure parser (`domain/spreadsheet.ts`, exceljs) turns a workbook into months of `{income[], items[]}` plus the sheet's own totals for cross-checking; a rule-based `suggestCategory` maps free-text labels to categories in the same bucket. The API is stateless: preview returns parsed rows; commit receives the rows the user confirmed plus the mapping, validates them like transactions, and writes them in one DB transaction tagged with an `importBatch` per month so a month can be skipped or replaced later. The file is sent as base64 JSON (keeps the JSON-only CSRF rule; no multipart), parsed in memory, never stored.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` Revision 1.1 §4.

## Findings from the real workbook (read-only inspection, 2026-10-07)

- Sheets: `Nov 23`, `Template` (skip), `Feb 24` … `Oct 26` — names are `<Mon|Month> <YY>` (`Jun`, `June`, `July`, `Sep`).
- Standard layout (Feb 24 →): income label/amount in **C/D rows 2–8**, then `Total Net income` (C9/D9), `Spend` (C10/D10), `Unused Amount` (C11/D11); bucket header row 15: **A/B Fundamentals, C/D Fun, E/F Future You**; items from row 16 down (seen to row 36). Summary block in I–L is ignored.
- Old layout (Nov 23): income label/amount in **A/B rows 1–5**, `Total Net income` A6/B6, header row 7, items from row 8.
- All amounts are EUR numbers (no formulas in item cells). "India Spend" is an ordinary Fun item in EUR — **Ruling:** no INR handling needed for this workbook (spec §4's "India-spend section as INR" does not match the real file).
- Labels are free text and vary month to month ("Restaurant", "hotel", "Flight (517+ 840)", "Marriage expense", "LIC Insurance" under Future You).

## Global Constraints

- All earlier constraints (family scoping ⇒ 404, `{data}`/`{error}`, CSRF/JSON only, BigInt money, never store the uploaded file, never commit real data or the user's workbook).
- Amounts: euros → cents with `Math.round(x * 100)`; zero/blank skipped; negative amounts reported as warnings and skipped.
- Imported rows become **individual transactions** dated the 1st of the month, `merchant` = the sheet label, `notes` = `Imported from "<sheet>"`, category from the mapping, `importBatch` = `xlsx:<YYYY-MM>`.
- A month is "already imported" when transactions with its `importBatch` exist: the user chooses **skip** (default) or **replace** (deletes only that month's imported rows, never manual ones). Months that already have manual transactions are flagged in the preview.
- Upload limit 10 MB (route-level `bodyLimit`); only `.xlsx`.

## Review Focus

1. Re-importing a month must never double-count: default skip; replace removes only that month's previously imported rows — test in Task 3.
2. Parsed totals must match the sheet's own `Total Net income` / `Spend` cells; mismatches are shown per month, not hidden — tests in Task 1, real-file dry run in Task 5.
3. A mapping or account from another family ⇒ 404 and nothing written (all-or-nothing) — test in Task 3.
4. A malformed/non-xlsx upload, or an empty workbook, gives a clear 400, not a 500 — test in Task 3.
5. Account balance side-effect: importing three years into a real bank account would distort its balance — default target is a new "Spreadsheet history" account (EUR, type other), with the choice explained in the UI.

---

### Task 1: Parser `parseSpendingWorkbook` (exceljs)

**Files:** `backend/src/domain/spreadsheet.ts`, `backend/test/domain/spreadsheet.test.ts`, `backend/test/fixtures/workbook.ts` (builds synthetic workbooks with exceljs — no real data in the repo).

**Interface:**

```ts
type ParsedMonth = { sheet: string; month: string /* YYYY-MM */;
  income: { label: string; amount: number }[];
  items: { bucket: 'essentials'|'fun'|'future'; label: string; amount: number }[];
  sheetTotals: { netIncome: number|null; spend: number|null };   // from the sheet's own cells, cents
  parsedTotals: { netIncome: number; spend: number };              // sums of what we read
  matches: boolean;                                                // both present totals equal parsed
  warnings: string[] };
parseSpendingWorkbook(buf: Buffer): Promise<{ months: ParsedMonth[]; skippedSheets: string[] }>
parseSheetMonth(name: string): string | null   // "Nov 23"→"2023-11", "June 26"→"2026-06", "Template"→null
```

Locate the bucket header row by finding a cell `Fundamentals` in column A (first 40 rows); income block = label/amount pairs above it in the column pair holding "Total Net income" (C/D or A/B), excluding the summary labels (`Total Net income`, `Spend`, `Unused Amount`, `Summary`); spend = items sum (Fundamentals + Fun + Future You, matching the sheet's own `Spend`). Formula cells use their cached result. Months sorted ascending.

Tests: standard layout parse; old (Nov 23) layout parse; sheet-name parsing incl. `June`, `July`, `Sep`, `Template`, junk; totals match ⇒ `matches: true`; an item outside the read area ⇒ mismatch flagged; decimals; zero/blank skipped; negative ⇒ warning; formula with cached result; label trimming; non-xlsx buffer ⇒ throws `INVALID_WORKBOOK`.

### Task 2: `suggestCategory` rules

**Files:** `backend/src/domain/categorize.ts`, `backend/test/domain/categorize.test.ts`.

**Interface:** `suggestCategory(label, kind, bucket, categories: {id,name,kind,bucket}[]): { categoryId: string } | { newName: string }` — 1) exact name (case/space-insensitive) in same kind+bucket; 2) keyword rules restricted to the same bucket (rent/mortgage→Rent; groceries→Groceries; transport/train/ticket/bus/car→Transportation; phone→Phone; electricity/water→Electricity; wifi/internet→Internet; insurance→Insurance; tax/ard→Tax; bank→Bank fees; gym/health/doctor→Health; restaurant/eating/hotel/food/oven→Restaurants; shopping/shoes/amazon(not prime)→Shopping; netflix/prime/spotify/subscription→Subscriptions; movie/tv/soundbar/entertainment→Entertainment; flight/trip/travel/vacation→Travel; gift/donation→Gifts; rd→Recurring deposit; stock→Stocks; etf/gold→ETF & Gold; grt/scheme/emergency/lic→Savings scheme; pension→Pension; income: salary→Salary; bonus→Bonus; tax→Tax refund; interest→Interest; dividend→Dividends; freelanc/side hustle/other→Other income); 3) otherwise `{ newName: label }` (title-cased, trimmed). Only suggests categories that exist; keyword target missing ⇒ newName.

Tests: exact match; keyword in right bucket; keyword ignored across buckets ("Insurance" under Future You does not map to essentials Insurance → falls to savings rule or new); unknown ⇒ newName; income rules.

### Task 3: Import API (preview + commit) and `importBatch`

**Files:** schema (`Transaction.importBatch String?` + index `[familyId, importBatch]`), migration `m4_import`; `backend/src/services/importService.ts`, `backend/src/routes/import.ts`, `backend/test/import.test.ts`.

**Contracts:**

- `POST /api/import/spreadsheet/preview { fileName: string, data: base64 }` (bodyLimit 10 MB) ⇒ `{ data: { months: (ParsedMonth & { existing: { imported: number; manual: number } })[], labels: { key, kind, bucket|null, label, occurrences, total, suggestion }[], skippedSheets } }` — `key` = `${kind}|${bucket ?? ''}|${normalizedLabel}`.
- `POST /api/import/spreadsheet/commit { account: { id } | { newName: string }, months: [{ month, mode: 'import'|'replace', income: [...], items: [...] , sheet }], mapping: Record<key, { categoryId } | { newName }> }` ⇒ validates everything first (account/categories in family ⇒ else 404; every row's key has a mapping ⇒ else 400; mapped category kind/bucket consistent ⇒ else 400; month not already imported unless `replace` ⇒ else 409 `MONTH_ALREADY_IMPORTED`), then in one DB transaction: create account (EUR = family spending currency, type `other`) if requested; create new categories (dedupe by name per kind; reuse existing case-insensitively); for `replace` delete `importBatch = xlsx:<month>`; `createMany` transactions. Returns `{ created, months, newCategories, accountId }`.

Tests: preview from fixture (labels aggregated, suggestions, existing counts); commit creates transactions with right type/bucket/date/merchant/importBatch and budget summary matches the sheet totals; second commit of same month ⇒ 409; replace ⇒ old imported rows gone, manual row untouched, no double count; new categories created once and reused; new account created in spending currency; foreign account/category ⇒ 404 and nothing written; missing mapping ⇒ 400; garbage base64 / non-xlsx ⇒ 400 `INVALID_WORKBOOK`; unauthenticated ⇒ 401.

### Task 4: Frontend — Import page

**Files:** `frontend/src/pages/ImportPage.tsx`, `components/import/{UploadStep,MappingStep,MonthsStep}.tsx`, `lib/files.ts` (`fileToBase64`), nav item "Import" (`Upload` icon), route `/import`.

UI (one page, three stacked steps that unlock in turn):

1. **Upload** — file input (.xlsx), privacy note ("read on this laptop only, not stored").
2. **Categories** — table of distinct labels grouped Income / Essentials / Fun / Future You: label, months seen, total, mapping select (categories of that kind+bucket + "New category: <label>"), suggestions preselected; count of new categories.
3. **Months** — list with checkbox (default on unless already imported or no rows), sheet totals vs parsed (✓ or ⚠ with both numbers), income / spend preview, badges "already imported → Skip/Replace", "N manual transactions this month"; target account select (default "Create 'Spreadsheet history' account", or existing spending-currency accounts) with the balance explanation; **Import N months** button → result summary with links to Budget for the first and last imported month.

### Task 5: E2E + real-file dry run

- `e2e/import.spec.ts`: generate a 3-month fixture workbook (exceljs, both layouts) to a temp file, upload, adjust one mapping, import, check Budget for one month equals the sheet totals, re-upload ⇒ months show "already imported"; screenshots.
- Dry run (not committed): run `parseSpendingWorkbook` + `suggestCategory` against the user's real file via a scratch script; report months parsed, total mismatches, label count and unmapped labels to the user.

## Completion

check + e2e + docker smoke; back up real DB; rebuild Docker; final review; fixes; report (including dry-run numbers).

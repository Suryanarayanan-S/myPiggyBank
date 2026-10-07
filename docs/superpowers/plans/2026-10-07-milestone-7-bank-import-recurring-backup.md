# Milestone 7 — Bank CSV Import, CSV Export, Recurring Transactions, Backup & Restore

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop typing what the bank already knows: import a bank statement CSV (e.g. Sparkasse) with preview, column mapping, validation, duplicate detection and learned category rules; export transactions as CSV; let fixed payments (rent, salary, insurance, RD) create themselves; and make the data safe to move or restore with `npm run backup` / `npm run restore`.

**Spec:** original §10 (recurring), §20 (CSV import: upload, preview, column mapping, validation, duplicate detection, confirmation — never import directly), §21 (CSV export), §22 (rule-based categorisation with room for AI later), v1 spec §2 Ops (backup/restore). The retro theme is out of scope (user request).

## Global Constraints

- All earlier constraints (family scoping ⇒ 404, `{data}`/`{error}`, JSON-only CSRF, BigInt money, uploads processed in memory and never stored, no real data in the repo).
- CSV import never writes before the user confirms; every committed row is re-validated on the server.
- Bank amounts: negative = expense, positive = income (an "invert signs" option covers banks that do it the other way); zero rows skipped with a warning.
- Duplicates: same account + date + amount + type + normalised description, either inside the file or already in the account ⇒ flagged and unticked by default.
- Recurring transactions: generated idempotently (unique per rule + date), never in the future, monthly/quarterly/yearly days clamp to the month end (31 Jan → 28/29 Feb).
- Backups use SQLite `VACUUM INTO` (consistent while the app runs); restore always keeps a safety copy of the database it replaces and refuses while the app is running.

## Review Focus

1. A Sparkasse-style file (semicolon, `dd.mm.yyyy`, `1.234,56`, Windows-1252 umlauts, quoted fields with `;` inside) parses correctly — tests in Task 2.
2. Re-importing the same statement imports nothing new by default (all rows flagged as existing duplicates) — test in Task 4.
3. A rule generating on the 31st of every month must produce Feb 28/29, Apr 30…, and generation run twice must not duplicate — tests in Task 5.
4. Restore must refuse when the target is not a myPiggyBank database and must keep the previous file — test in Task 1.
5. CSV export must neutralise spreadsheet formula injection (`=`, `+`, `-`, `@` at cell start) and include only the caller's family — test in Task 4.

---

### Task 1: Backup & restore scripts

**Files:** `scripts/backup.mjs`, `scripts/restore.mjs`, root `package.json` scripts, `backend/test/backup.test.ts`.

- `npm run backup [-- --db data/piggybank.db] [--out backups/]` ⇒ `backups/piggybank-YYYYMMDD-HHMMSS.db` via `VACUUM INTO`; prints path and size; keeps the 20 newest auto backups (older ones are deleted only if they match the script's own naming).
- `npm run restore -- <file> [--db data/piggybank.db]`: checks the file is SQLite with a `_prisma_migrations` table and a `Family` table; refuses if something answers on the app's port (8080 Docker / 3001 dev) unless `--force`; copies the current DB to `backups/before-restore-<timestamp>.db`; removes stale `-wal`/`-shm`; copies the backup in place.
  Tests (spawn the scripts against a temp DB): backup produces a readable copy with the same rows; restore replaces data and keeps a safety copy; restore of a non-SQLite or foreign SQLite file fails with exit code ≠ 0 and leaves the DB untouched.

### Task 2: Domain — bank CSV parsing

**Files:** `backend/src/domain/csv.ts`, `backend/test/domain/csv.test.ts`.
`decodeText(buf)` (UTF-8 with BOM handling; falls back to Windows-1252 when the bytes are not valid UTF-8); `parseCsv(text)` ⇒ `{ delimiter, rows: string[][] }` (auto-detects `;` `,` tab; RFC-4180 quotes, doubled quotes, newlines in quotes, CRLF); `guessMapping(headers)` ⇒ `{ date, description, amount, currency? }` column indexes from common names (Buchungstag/Datum/Date, Verwendungszweck/Beguenstigter/Description/Payee, Betrag/Amount); `parseBankDate(s, format)` for `dd.mm.yyyy | dd/mm/yyyy | yyyy-mm-dd | mm/dd/yyyy` (two-digit years ⇒ 20xx); `parseBankAmount(s, decimal: ',' | '.')` ⇒ signed cents or null.
Tests: Sparkasse sample (semicolon, quotes, `-52,40`, umlauts in cp1252), comma CSV with `"1,234.56"`, tab CSV, BOM, empty trailing lines, invalid dates (31.02.2026) and amounts.

### Task 3: Rule-based bank categorisation + learned rules

**Files:** schema `CategoryRule { id, familyId, pattern, categoryId(Cascade), createdAt; @@unique([familyId, pattern]) }`, migration `m7_rules_recurring` (with Task 5's tables); `backend/src/domain/categorize.ts` (`suggestForBank(description, type, categories, rules)`), tests.
Order: learned rules (longest matching pattern, case-insensitive substring) ⇒ built-in merchant keywords (REWE/EDEKA/ALDI/LIDL/NETTO/PENNY/KAUFLAND ⇒ Groceries; NETFLIX/SPOTIFY/DISNEY/PRIME ⇒ Subscriptions; DB/BAHN/MVV/BVG/HVV/UBER/SHELL/ARAL ⇒ Transportation; MIETE ⇒ Rent; TELEKOM/VODAFONE/O2 ⇒ Phone; STADTWERKE/STROM ⇒ Electricity; LIEFERANDO/RESTAURANT/MCDONALD ⇒ Restaurants; AMAZON ⇒ Shopping; VERSICHERUNG/ALLIANZ/HUK ⇒ Insurance; GEHALT/LOHN/SALARY ⇒ Salary; ZINSEN/INTEREST ⇒ Interest) restricted to categories of the matching kind that exist ⇒ null. Interface stays provider-shaped so an AI provider can replace it later.

### Task 4: CSV import + export API

**Files:** `backend/src/services/bankImportService.ts`, `backend/src/services/exportService.ts`, routes, `backend/test/bank-import.test.ts`, `backend/test/export.test.ts`, schema: none beyond Task 3 (rows use `importBatch = "csv:<uuid>"`).

- `POST /api/import/csv/preview { fileName, data: base64 }` ⇒ `{ delimiter, headers, rows (≤ 5000), mapping (guessed) }`.
- `POST /api/import/csv/analyze { accountId, rows, mapping: { date, description, amount, dateFormat, decimal, invert } }` ⇒ per row `{ index, date|null, amount|null, type, description, error|null, duplicate: 'file'|'existing'|null, suggestion: categoryId|null }` + summary counts.
- `POST /api/import/csv/commit { accountId, rows: [{ date, amount, type, description, categoryId|null }], rememberRules?: [{ pattern, categoryId }] }` ⇒ re-validates (category kind matches type, family scoping), creates transactions (merchant = description, notes "Imported from bank statement", `importBatch`), upserts learned rules; returns `{ created }`.
- `GET /api/export/transactions.csv?from&to` ⇒ `text/csv; charset=utf-8` with BOM, `;` delimiter, columns Date;Type;Amount;Currency;Account;Category;Bucket;Member;Merchant;Notes;Tags; formula-injection-safe.
  Tests: preview of the Sparkasse fixture; analyze flags invalid rows, in-file and existing duplicates, suggestions incl. learned rule; commit creates rows and learns rules; re-import ⇒ all existing duplicates; foreign account/category ⇒ 404 nothing written; export content, CSV escaping, injection neutralised, isolation.

### Task 5: Recurring transactions

**Files:** schema `RecurringRule { id, familyId, name, type, amount BigInt, accountId(Cascade), categoryId?(SetNull), memberId?(SetNull), transferAccountId?, frequency 'weekly'|'monthly'|'quarterly'|'yearly', startDate, endDate?, lastGenerated DateTime?, active Boolean, createdAt/updatedAt }`, `Transaction.recurringRuleId String?` + `@@unique([recurringRuleId, date])`; `backend/src/domain/recurring.ts` (`occurrences(rule, from, to)`), `backend/src/services/recurringService.ts` (`generateDue(prisma, familyId?, today)`), routes `GET/POST/PUT/DELETE /api/recurring`, `POST /api/recurring/run`, `GET /api/recurring/upcoming?days=30`; server runs `generateDue` at startup and hourly.
Tests: occurrences for each frequency, month-end clamping (31st ⇒ Feb 28/29), end date, start in the future; generation creates due transactions only up to today, is idempotent, respects paused rules, links `recurringRuleId`; editing a rule doesn't rewrite past transactions; isolation.

### Task 6: Frontend

- Import page gets two tabs: **Spreadsheet** (existing) and **Bank statement (CSV)**: upload → mapping (column selects, date format, decimal separator, invert, target account) → review table (checkbox, date, description, amount, category select with suggestions, duplicate/invalid badges, "remember" toggle for changed categories) → import N rows → result.
- Transactions page: **Export CSV** button (current month filter range).
- **Recurring** page (`/recurring`, under More/sidebar): list with next date, amount, frequency, account, active toggle; add/edit modal; "Upcoming 30 days".

### Task 7: E2E + screenshots

Bank CSV import with a Sparkasse-like fixture (incl. re-import ⇒ duplicates), recurring rule creating this month's transaction, export download contains rows; screenshots light/dark/mobile.

## Completion

check + e2e + docker smoke; backup via the new script (real DB) before rebuilding Docker; final review; fixes; report.

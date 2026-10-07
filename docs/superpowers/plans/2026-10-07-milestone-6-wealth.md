# Milestone 6 — Family Wealth (Assets, Liabilities, Net Worth, Snapshots)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the user's "Financial Report" sheet: family wealth in INR with one column per member (Appa, Surya, Adhira, Dayana, Shared) and rows Liquid funds / Property / Investments / Other, minus liabilities; totals and shares; a dated net-worth history with notes ("Car withdraw", "Adding German account").

**Architecture:** Manual **assets** with valuation history and **liabilities** with balance history (latest entry = current value). A pure `computeNetWorth` combines non-archived accounts (by their asset class and owner), assets and liabilities, converting everything into the family's `wealthCurrency` with the latest exchange rate. **Snapshots** store a dated total plus breakdown and an optional note; they can be taken from the current state or entered manually (for history from the old sheet). Amount inputs accept lakh/crore (`80 L`, `1.2 Cr`).

**Spec:** Rev 1.1 §5 (family wealth per member, asset classes, snapshots with notes) and original §15–17 (net worth, assets, liabilities).

## Global Constraints

- All earlier constraints (family scoping ⇒ 404, `{data}`/`{error}`, CSRF, BigInt money ⇒ numbers in DTOs, no real data in the repo).
- Net worth = Σ non-archived account balances (credit-card accounts count as they are: a negative balance reduces net worth) + Σ latest asset valuations − Σ latest liability outstanding, all converted to `wealthCurrency` using the rate of the current month (fallback: latest earlier). Amounts with no rate are excluded and reported in `unconverted`.
- Asset classes: `liquid | property | investment | other` (same as accounts). Liabilities sit in their own row.
- Debt ratio = liabilities ÷ assets (bp), null when assets = 0.
- Snapshot comparisons: "previous month" = latest snapshot at least 28 days older than today; "previous year" = latest snapshot at least 365 days older.

## Review Focus

1. EUR account balances must be converted into INR (never added 1:1); a missing rate is surfaced — test in Task 1.
2. An archived account (e.g. "Spreadsheet history") must not count towards net worth — test in Task 1.
3. Valuation/balance history: the current value is the entry with the latest date (not the latest created) — test in Task 2.
4. Another family's asset/liability/snapshot ids ⇒ 404 and nothing changed — tests in Task 2.
5. Lakh/crore input parsing must never silently mis-scale (e.g. "1.2 Cr" = ₹1,20,00,000; "80L" = ₹80,00,000; "80 lakh" ok; garbage rejected) — test in Task 3.

---

### Task 1: Schema + domain `computeNetWorth`

**Files:** schema (`Asset`, `AssetValuation`, `Liability`, `LiabilityBalance`, `NetWorthSnapshot`), migration `m6_wealth`; `backend/src/domain/networth.ts`, `backend/test/domain/networth.test.ts`.

```prisma
model Asset { id, familyId(Cascade), name, assetClass String, currency, ownerMemberId String?(SetNull), notes String?, createdAt/updatedAt, valuations AssetValuation[]; @@unique([familyId,name]) }
model AssetValuation { id, assetId(Cascade), date DateTime, value BigInt, note String?, createdAt; @@index([assetId,date]) }
model Liability { id, familyId(Cascade), name, type String /* mortgage|car_loan|personal_loan|credit_card|other */, currency, ownerMemberId String?(SetNull), originalAmount BigInt?, interestRateBp Int?, monthlyPayment BigInt?, startDate DateTime?, endDate DateTime?, lender String?, notes String?, createdAt/updatedAt, balances LiabilityBalance[]; @@unique([familyId,name]) }
model LiabilityBalance { id, liabilityId(Cascade), date DateTime, outstanding BigInt, createdAt; @@index([liabilityId,date]) }
model NetWorthSnapshot { id, familyId(Cascade), date DateTime, currency, assets BigInt, liabilities BigInt, netWorth BigInt, breakdown String /* JSON */, note String?, createdAt/updatedAt; @@index([familyId,date]) }
```

`computeNetWorth({ currency, month, rates, members, accounts: {name, balance, currency, assetClass, ownerMemberId, archived}[], assets: {name, value|null, currency, assetClass, ownerMemberId}[], liabilities: {name, outstanding|null, currency, ownerMemberId}[] })` ⇒ `{ currency, assets, liabilities, netWorth, debtRatioBp, byClass: {liquid,property,investment,other}, columns: [{memberId|null, name, liquid, property, investment, other, liabilities, netWorth}] /* members in order, Shared last, only non-empty */, unconverted }`.
Tests: per-member/class matrix like the sheet; EUR→INR conversion with inverse rate; missing rate ⇒ unconverted; archived account excluded; negative credit-card balance reduces liquid; liabilities subtract; debt ratio; empty family.

### Task 2: Wealth API

**Files:** `backend/src/services/wealthService.ts`, `backend/src/routes/wealth.ts`, `backend/test/wealth.test.ts`.

- Assets: `GET/POST/PUT/DELETE /api/assets` (create takes optional initial `value` + `date`), `POST /api/assets/:id/valuations {date, value, note?}`, `DELETE /api/assets/:id/valuations/:valuationId`. DTO includes `value` (latest by date), `valuedAt`, `history` (date desc).
- Liabilities: same shape with `balances`/`outstanding`; fields original amount, interest rate (`"3.75"` % → bp), monthly payment, start/end date, lender, notes.
- `GET /api/net-worth` ⇒ `{ current: computeNetWorth(...), snapshots: [...] (date asc), previousMonth, previousYear }`.
- Snapshots: `POST /api/net-worth/snapshots { note? }` (from current state, today) and `{ date, netWorth, note? }` (manual history entry, assets/liabilities unknown ⇒ stored as netWorth/0 with `breakdown: null`); `PUT /api/net-worth/snapshots/:id { note }`; `DELETE`.
  Tests: CRUD + validation; current value = latest by date even if inserted out of order; liability interest parsing; net-worth endpoint matches domain; snapshot from current state stores breakdown; manual snapshot; previousMonth/previousYear selection; isolation (404, nothing changed); owner member from another family ⇒ 404.

### Task 3: Frontend — lakh/crore input

`parseAmountInput(text, currency)` extends `parseMoneyInput`: suffixes `L`, `lakh`, `lac`, `Cr`, `crore` (case-insensitive, optional space, ₹ allowed) for any currency; Indian grouping still works. Tests: `80 L`, `80L`, `80 lakh`, `1.2 Cr`, `1,2 Cr`, `0.5 cr`, `25,00,000`, `₹25 L`, rejects `L`, `80 X`, `1.2.3 Cr`.

### Task 4: Frontend — Wealth page

**Files:** `frontend/src/pages/WealthPage.tsx`, `components/wealth/{NetWorthHeader,MemberTable,AllocationBar,AssetList,LiabilityList,ValueForm,SnapshotHistory}.tsx`, nav "Wealth" (`Landmark` icon), route `/wealth`.

- Header: net worth hero (compact INR, e.g. ₹1.56 Cr, with full value), assets, liabilities, debt ratio, change vs previous month / year snapshot.
- Member table (like the sheet): rows Liquid funds / Property / Investments / Other / Liabilities / Net worth; one column per member + Shared + Total; values in compact INR with full value on hover; shares (%) of the total column.
- Allocation: one horizontal 100 % bar by class with legend + table view (dataviz rules; classes use a separate validated categorical order).
- Assets & liabilities lists: owner, class/type, current value, last updated; add/edit modal; "Update value" (date + amount, lakh/crore input) with history list and delete; liabilities show rate, monthly payment, lender.
- Snapshot history: line chart of net worth over time (single series) + table/list with notes; "Save today's snapshot" (with note); "Add past entry" (date, amount, note) for the old sheet's history; edit note; delete.
- Unconverted warning linking to Settings.

### Task 5: E2E + screenshots

Register → add members Appa/Adhira/Dayana → add assets (Property 80 L Appa, Land 20 L Surya, FD 5 L Adhira…) and an EUR account; add an EUR→INR rate; add a liability → Wealth shows the member table totals and net worth; add a past snapshot + save today's snapshot with a note → history shows both; screenshots light/dark/mobile.

## Completion

check + e2e + docker smoke; back up real DB; rebuild Docker; final review; fixes; report.

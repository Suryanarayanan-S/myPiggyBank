# Milestone 5 — Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native/inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A dashboard that answers, for any period: how much came in, how much was spent, how much went to Future You, what was left unused, the savings rate, how the 50/30/20 split moved over time, where the money went (categories, members), and what changed versus the previous period — with up to ~3 years of imported history.

**Architecture:** One pure domain function `buildDashboard` reuses `summarizeMonth` per month (so dashboard and Budget page can never disagree), sums the months for period totals, and computes the same for the immediately preceding period of equal length. One endpoint `GET /api/dashboard?from=YYYY-MM&to=YYYY-MM`. Frontend: one filter row (period presets + custom), hero figure + stat tiles with deltas, Recharts charts following the dataviz skill, a table view for every chart, and computed (non-advisory) insights.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` — §2 Dashboard row, Rev 1.1 §2 money math; insights per original prompt §23 (computed from data, no advice).

## Global Constraints

- Money math = `summarizeMonth` (M3); period totals are sums of monthly results; savings rate = (future + unused) / netIncome over the period. Conversion uses each month's own rate; unconverted amounts are reported, never added 1:1.
- Range: `from ≤ to`, at most 120 months; previous period = the same number of months immediately before `from`.
- Charts (dataviz skill): entity colours fixed across the app — Essentials `#2a78d6`/dark `#3987e5`, Fun `#eb6834`/`#d95926`, Future You `#1baf7a`/`#199e70` (validated all-pairs both modes; light aqua < 3:1 ⇒ relief via legend + table view); net income is a neutral ink line on the **same** € axis (no dual axis); single-series charts (savings rate, members) use violet `#4a3aa7`/`#9085e9` and never share a chart with blue. 2px lines, ≤24px bars with 4px rounded data-ends, hairline solid grid, legend for ≥2 series, tooltip with value first, a table view for every chart, text never in series colour.
- Insights are factual comparisons only (no advice), each tagged good / warning / info with an icon + text.

## Review Focus

1. Dashboard totals for a single month must equal the Budget page for that month — test in Task 2.
2. Months with no transactions inside the range still appear (zero), so trends don't silently skip months — test in Task 1.
3. A period with zero income: savings rate "—", no division by zero, insights don't claim percentages — tests in Tasks 1 and 3.
4. Unconverted INR amounts in the range are surfaced on the dashboard — test in Task 2 + UI warning.
5. Large ranges (120 months, ~700 rows) respond quickly and charts stay readable (tick thinning) — e2e/screenshot in Task 5.

---

### Task 1: Domain `buildDashboard`

**Files:** `backend/src/domain/dashboard.ts`, `backend/test/domain/dashboard.test.ts`.
**Interface:** `monthsBetween(from, to): string[]`; `buildDashboard({ from, to, currency, txns: (SummaryTxn & { month: string; memberId: string|null })[], rates, targets, categories, members: {id,name}[] })` ⇒ `{ from, to, currency, months: MonthPoint[], totals: Totals, previous: Totals|null, categories: {categoryId,name,bucket,actual}[] /* expense, desc, >0 */, members: {memberId|null,name,actual}[] /* spent (essentials+fun+uncategorised), desc, "Shared" for null */, unconverted }` where `MonthPoint = { month, netIncome, essentials, fun, future, uncategorised, spent, unused, savingsRateBp, sharesBp: {essentials,fun,future} }` and `Totals` = same money fields + savingsRateBp + sharesBp. `txns` may include the previous period; the function splits by month.
Tests: months listed including empty ones; totals = sum of months; previous period computed from the preceding equal-length range (null when no txns there); categories/members aggregated and sorted; member "Shared"; zero-income period; conversion per month; range > 120 ⇒ throws.

### Task 2: `GET /api/dashboard`

**Files:** `backend/src/services/dashboardService.ts`, `backend/src/routes/dashboard.ts`, `backend/test/dashboard.test.ts`.
Response adds `accounts: {currency, balance}[]` (non-archived, summed per currency), `firstMonth: string|null` (earliest transaction month, for "All time"), `targets`.
Tests: single month equals `/api/budget/:month` money fields; three-month range totals; previous; unconverted INR surfaced; bad/inverted/too-long range ⇒ 400; isolation; archived accounts excluded from `accounts`.

### Task 3: Frontend libs — periods & insights

**Files:** `frontend/src/lib/periods.ts` (+test), `frontend/src/lib/insights.ts` (+test), install `recharts`.
`periodRange(preset, today, firstMonth)` for `this-month | last-month | last-3 | this-year | last-12 | all | custom`; `insightsFor(totals, previous, targets, currency)` ⇒ `{tone: 'good'|'warning'|'info', text}[]` — spending change vs previous period (%), savings-rate change (pp), each bucket vs target (over for essentials/fun, under for future), biggest category share; nothing percentage-based when income is 0.

### Task 4: Dashboard page

**Files:** `frontend/src/pages/DashboardPage.tsx`, `components/dashboard/{PeriodFilter,StatTiles,CashFlowChart,SavingsRateChart,ShareChart,CategoryBars,MemberBars,Insights,ChartCard,ChartTooltip}.tsx`, `lib/chartColors.ts`.
Layout: filter row → hero (savings rate) + tiles (Net income, Spent, Future You, Unused) with deltas vs previous period → Insights → Cash flow (stacked Essentials/Fun/Future You columns + net income line, one € axis) → Savings rate trend (line) and Share of income (three lines in %, target values in legend) → Top categories (horizontal bars coloured by bucket) and Spending by member (violet bars) → account balances strip. Every chart card has "Show table". Holds previous render at reduced opacity while refetching.

### Task 5: E2E + screenshots

`e2e/dashboard.spec.ts`: register → import a 3-month fixture → dashboard "Last 3 months" shows totals equal to the sheet sums, insights visible, table view toggles; screenshots desktop/mobile light/dark; inspect visually (labels, overlap, axis band).

## Completion

check + e2e + docker smoke; back up real DB; rebuild Docker; final review; fixes; report.

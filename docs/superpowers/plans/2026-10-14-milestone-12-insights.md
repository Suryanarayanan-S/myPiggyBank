# Milestone 12 — Insights

**Spec:** `docs/superpowers/specs/2026-10-14-mypiggybank-v2-features-design.md` (M12).

Observations computed from the family's own numbers — never advice, never "you should". Each
names its numbers and links to where they come from.

## Rules (domain `insights.ts`, pure; thresholds in one exported object)

Months: the **current** month (in progress) and the six **full** months before it. Amounts in
the spending currency (or `?currency=`); unconvertible amounts are left out and said so.

| Kind | When | Example text |
| --- | --- | --- |
| `rising` | a category grew three full months in a row, each step ≥ 5 % and ≥ €10 | "Groceries rose three months in a row: €310 → €355 → €402." |
| `vsAverage` | last full month is ≥ 30 % and ≥ €50 above or below the category's average of the five months before it (only the biggest one) | "In September, Restaurants was 48 % above its usual (€310 vs €209)." |
| `overLimit` | this month over its limit; plus how many of the last six full months were over | "Groceries is €46 over its limit this month — also over in 3 of the last 6 months." |
| `subscription` | same merchant in ≥ 3 of the last 4 full months, amounts within 10 % of their median | "Netflix looks like a subscription: about €13.99 a month, €168 a year." |
| `savingsTrend` | average savings rate of the last 3 full months differs from the 3 before by ≥ 3 points | "Savings rate went up: 31 % over the last 3 months, 24 % the 3 before." |
| `goalBehind` | active goal behind or past its date | "House deposit is behind: €310 a month needed, €120 a month saved lately." |
| `holding` | the biggest gain and biggest loss among open holdings, if ≥ 5 % | "MSCI World ETF is up 16 % (+€212)." |
| `large` | a transaction in the last 30 days ≥ 3× its category's median over six months (≥ 5 earlier rows) and ≥ €50 | "€840 at MediaMarkt on 3 Oct is about 6× a usual Shopping payment." |

Quick-entry / spreadsheet monthly totals count for categories and trends but not for
subscriptions or single large payments (they are not single payments).

Each insight: `{ id, kind, tone: 'good' | 'warning' | 'info', data, link, size }` — the server finds
what to say and the numbers; the frontend writes the sentence (`lib/insightText.ts`, tested) so money
is formatted like everywhere else (lakh grouping for INR); ordered warning →
info → good, then by size. The dashboard shows the first three; the Insights page shows all.

## Tasks

1. Domain module with tests for every kind, including the "not enough data" cases.
2. Service + `GET /insights?currency=` (family-scoped; reuses budget, goals and holdings
   services) with API tests.
3. Frontend: Insights page, dashboard card (top three, replacing the period-only insights card's
   place), navigation; e2e with screenshots.

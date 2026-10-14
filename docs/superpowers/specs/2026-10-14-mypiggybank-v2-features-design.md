# myPiggyBank v2 features — design

**Date:** 2026-10-14 · **Extends:** `2026-10-07-mypiggybank-v1-design.md` (Revision 1.1), its
"Later" list items 2–5. Family logins (item 7) follow afterwards as their own milestone.

## Purpose

Replace what the spreadsheets did beyond monthly spending, and answer three questions the app
cannot yet: *Are we on track for what we're saving for?* *What are our investments worth and how
are they doing?* *How did this year compare with last year?* — plus observations computed from
the family's own numbers.

Same rules as v1: integer money with currency; never convert 1:1 without a rate; everything
family-scoped; no advice, no live market data, no XIRR (still out of scope).

## M9 — Savings goals

- A **goal**: name, target amount + currency, optional target date, optional member, optional note.
- **Progress** ("saved so far") comes from what the goal is linked to, so it stays current by
  itself: any mix of **accounts** (their balance, e.g. Tagesgeld), **assets** (their latest value,
  e.g. Gold) and **holdings** (from M10, once it exists) — plus **manual entries** (dated
  amounts, for money kept elsewhere). Everything is converted into the goal's currency.
- Shown per goal: progress bar and %, amount left, and — with a target date — the monthly amount
  needed ("€310/month to reach it by Dec 2027") and **on track / behind**, judged by the average
  monthly growth over the last 3 months.
- A goal can be marked **reached** (kept in a "Reached" list) or archived.
- New page *Goals* (navigation under "More" on phones); a small Goals card on the dashboard.

## M10 — Investments

- A **holding**: name, kind (stock, ETF, mutual fund, gold, other), optional ticker/ISIN,
  currency, owner member, optional account it sits in (a depot).
- **Trades**: buy / sell (date, units, price per unit, fees) and **dividends** (date, amount).
  **Prices** are entered by hand (date, price per unit); the latest price values the holding.
- Computed: units held, average cost (average-cost method), invested amount, current value,
  unrealised and realised profit/loss (amount and %), dividends received, allocation by kind and
  by member.
- **Net worth** counts holdings in the *investment* class for their owner. An account marked as
  a depot is not counted twice.
- Recurring deposits, FDs and saving schemes stay **assets with valuations** (they have no units).
- Buying does not create a spending transaction: the money leaving the bank is already recorded
  as a "Future You" expense in the budget.
- New page *Investments*.

## M11 — Reports

- A **year report** for a chosen year: per month income, Essentials, Fun, Future You, unused and
  savings rate; year totals and averages; the same against the previous year (change in amount
  and %); category totals with their change; spending per member; net worth at the start and end
  of the year (from snapshots).
- Honours "Show in" like every page. Download as CSV; the page prints cleanly (browser print).
- New page *Reports*.

## M12 — Insights

Plain-language observations computed from the data, never advice. Each names its numbers and
links to where they come from. In addition to today's dashboard insights:

- a category rising three months in a row; the biggest change against its 6-month average;
- categories over their limit this month, and how often in the last 6 months;
- likely subscriptions (same merchant and similar amount every month) and their yearly cost;
- savings-rate trend over 6 months;
- goals that fell behind; holdings with the biggest gain or loss;
- a transaction more than 3× its category's typical amount.

Shown on the dashboard (top 3) and an *Insights* page (all). Thresholds live in one tested module.

## Out of scope (unchanged)

Live market prices, XIRR, advice, PDF export, AI categorisation, public hosting.

## Order

M9 Goals → M10 Investments (goals can then link holdings) → M11 Reports → M12 Insights →
family logins and home-network access.

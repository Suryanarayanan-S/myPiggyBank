# Currency switch and live rates — Implementation Plan

**Goal:** View every page's money in any supported currency with one switch, and optionally use
daily ECB reference rates (via Frankfurter) instead of only hand-entered monthly rates.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` (Revision 1.1), plus the
design agreed in chat on 2026-10-08 (summarised below; it extends the spec's "multi-currency
conversion" later-item).

## Agreed design

- Currencies: EUR, INR, USD, GBP plus CHF, AUD, CAD, SGD (all in the ECB set, all 2 decimals).
- **View currency** ("Show in"): `Default` (spending currency for dashboard/budget/transactions,
  wealth currency for wealth/accounts) or one fixed currency for every page. Remembered per
  browser. Monthly figures use that month's rate; current balances / net worth use the latest.
- **Rate mode** per family: `manual` (default, today's behaviour) or `live`.
  - Live rates are public data in a global `LiveRate` table: one EUR→X rate per month, the
    current month refreshed daily, past months backfilled with the month-end rate.
  - Cross rates (e.g. INR→USD) are derived via EUR.
  - In live mode a hand-entered rate for the same month and pair wins.
  - Only "give me rates" goes out; no family data. Offline → last stored rates, with their date.
- Budget limits stay stored in the spending currency; in another view currency they are shown
  converted and are read-only.
- Snapshots stay stored in their own currency and are converted for display (their month's rate).

## Tasks

1. **Domain** — currency list, `expandLiveRates`, `mergeRates` (manual wins per month+pair). Unit tests.
2. **Schema + rate loading** — `Family.rateMode`, `LiveRate` model; `loadRates()` used by
   budget, dashboard and wealth; family settings accept `rateMode`. API tests.
3. **Live fetcher** — `refreshLiveRates(prisma, fetch, today)`: latest + month-end backfill from
   the first transaction month; `GET /rates/live`, `POST /rates/live/refresh`; server runs it at
   startup and every 6 h when any family uses live mode. Tests with a fake fetch (never network).
4. **View currency on the API** — optional `?currency=` on budget, dashboard, net worth, accounts
   and transactions (converted totals). API tests.
5. **Frontend** — `lib/viewCurrency.ts` (+ tests), "Show in" switch in sidebar / phone header,
   pages pass the currency, Settings rates card gets the Live/Manual switch and status. E2E.

## Review Focus

- A month with no rate at all in the chosen view currency: amounts listed as unconverted, never 1:1.
- Live provider down / returns garbage: keep old rates, record the error, never crash startup.
- Manual rate entered for a month in live mode must win over the live rate for that month only.
- Switching view currency must not let a limit be saved in the wrong currency.
- Snapshots in another currency than the view must convert or be flagged, not mixed silently.

# Analytics → Currencies — plan

Goal: see how the euro, the dollar and the rupee move against each other, and how the family's
own euro⇄rupee transfers compare with the market rate.

## Decisions

- **New section "Analytics"** in the menu (room for more analytics later); first tab
  **Currencies** (`/analytics`).
- **Rates**: the ECB's daily reference rates (official, free, no key; already used for gold in
  euros): dollars per euro and rupees per euro, from 2020. Dollar→rupee = rupees per euro ÷
  dollars per euro. Stored as BenchmarkPoint series `usdPerEur` (exists) and `inrPerEur` (new),
  one ECB request for both (`D.USD+INR.EUR.SP00.A`).
- **"Live, whenever possible"**: the ECB publishes once a working day (~16:00 CET); there is no
  free official intraday source. The rates are fetched in the daily run (as now) *and* when the
  Analytics page opens, at most once an hour (FetchMark `ecb-rates`), so the page is as fresh as
  the ECB. The page says the date of the latest rate.
- **The page**:
  1. Three tiles — 1 € in ₹, 1 $ in ₹, 1 € in $: the rate, and its change over a day, a month and
     a year.
  2. A chart with ranges (1M, 3M, 6M, 1Y, 3Y, All) and two views: **Change %** (the three pairs
     from the range's start on one chart, to compare them) and **Rate** (one pair's rate).
  3. **Your transfers**: each transfer between a euro and a rupee account (both amounts are
     recorded): your rate, the ECB rate that day (or the last before), the difference in % and in
     the received currency; a total of what the rates cost or gained.
- Endpoint `GET /analytics/currencies` → `{ asOf, series: [{date, usdPerEur, inrPerEur}],
  transfers: [...], refreshed? }`. Pure maths (pairs, changes, transfer comparison) in
  `domain/fx.ts`, tested.

## Steps (test-first, one commit)

1. `domain/fx.ts` (rate on a day, pair series, change over N days, transfer vs market).
2. ECB fetch for both currencies; on-demand refresh with the hourly mark; endpoint; tests.
3. Frontend: nav + route, tiles, chart (existing chart system), transfers table; e2e.
4. Check, e2e, review, deploy (backup first).

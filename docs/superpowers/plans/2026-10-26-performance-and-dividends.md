# Performance history from the first trade, and a Dividends tab

## Goal

- Value over time (yours, Nifty 50, GOLDBEES, Gold 22K/24K, world gold) from the first trade
  (2020 for the real data), not only from when daily prices started.
- Investments tabs: Overview · Performance · Dividends · Holdings. Value over time moves to
  Performance.
- Dividends tab like Console's report: type (dividend / interest / both), date range, totals,
  search, a table (symbol, ex-date, qty, per share, total), CSV download; the quarterly chart, the
  automatic check and the splits/mergers history move there too.

## Data

- **Old splits already in the trades.** A split or bonus from NSE's history that the trades
  already show in today's units (not a Paytm-style own lot, not left to check) is recorded on the
  holding as a HoldingAction with status `included`; prices downloaded before it are restated
  once, and `adjustedClose` counts `included` like `applied`. Then every price written for a
  past day (daily backfill or the weekly one) is in the trades' units.
- **Weekly history** (new marketHistoryService, run after the daily dividend check): for each
  week from the first trade until today that has nothing yet (the daily backfill fills in the
  days of the last year later), the week's last trading day from NSE's archive
  (sec_bhavdata_full, ind_close_all): holding closes (former symbols too), GOLDBEES and Nifty 50.
  Each week is tried once (a FetchMark with the time), again only for trades entered since; a
  failing week is skipped (three in a row end the run); each step runs even if another fails.
- `included` only for history rows at least 60 days old that the daily list never had, and not
  within 30 days of an action the holding already has (the list's are the app's to apply).
- **World gold** before the daily collection: freegoldapi.com once (World Bank monthly averages,
  then daily).
- **IBJA 22K/24K** has no free history: estimated from GOLDBEES before IBJA's first stored day
  (series `gold24kEst`/`gold22kEst`), ratio IBJA ÷ GOLDBEES fitted over time through the RBI
  gold bond issue prices (IBJA 999 averages, ~12 days before each issue) and the stored IBJA days;
  22K = 24K × the stored 22K/24K ratio. The chart says where the estimate ends.
- **Payout list**: GET /holdings/payouts — each dividend/interest with the units held the day
  before (as the dividend check counts them) and the amount per share.

## Tests

- included splits: created once, prices restated, own-lot and review left alone
- weekly history: the right days, holding closes adjusted and under former symbols, Nifty/GOLDBEES,
  done weeks not asked again, a holiday Friday falls back to Thursday
- estimate fit (domain, pure); world gold import before the first collected day
- payouts: units and per share; frontend filters, totals, CSV (lib, pure); e2e tabs

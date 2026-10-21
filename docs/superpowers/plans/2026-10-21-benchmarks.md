# Value over time: compared with Nifty 50 and gold

User ask: Nifty 50 and the Indian gold price next to the portfolio's "Value over time".

## Honest comparison

- Different units (₹ value, index points, ₹/gram): never two axes. A second view of the card
  shows **% change since a common start** for all three lines.
- The portfolio line is a **time-weighted return** (buys and sells on a day are taken out of
  that day's change), so adding money never looks like a gain.

## Data (with the opt-in daily NSE download; nothing extra goes online without it)

- Nifty 50: NSE `content/indices/ind_close_all_DDMMYYYY.csv`, row "Nifty 50", closing value.
- Gold in India: GOLDBEES close from the daily price file (an ETF tracking the domestic gold
  price) — labelled "Gold (GOLDBEES)".
- `BenchmarkPoint(series, date, value micros)`; public, not family data.
- Backfill: trading days since the earliest open holding's first trade (≤ 366 days), at most
  10 days per run, oldest first; those days also get holding closes (value history fills in).
  Days NSE has no file for (holidays) are skipped for the rest of the process.
- `GET /holdings/benchmarks` → `{ nifty50: [{date, value}], gold: [...] }`.

## Frontend

- `lib/portfolio.ts`: `returnIndex(holdings)` (time-weighted) and `compareSince(...)`.
- Value over time card: "Value (₹)" | "vs Nifty 50 & gold" switch; 3 lines, legend, table view;
  a note to switch on NSE prices when there is no benchmark data.

**After review:** backfill starts at the first trade of a holding still held and listed on NSE
(sold-out holdings and ones without a symbol do not reach back); a past day counts as done only
when gold, Nifty 50 (unless NSE has no close that day) and every holding held that day have
closes, so holdings added later with older trades are filled in too; warnings from the side steps
are collected, never overwritten.

## Gold choices (follow-up)

User ask: 22K and 24K gold per gram and the 1-ounce USD price, with tick boxes.

- IBJA (ibjarates.com): the day's evening rate (else morning) for 999 and 916 per 10 g → ₹/g;
  today's separate rates only when the page's chart ends on today and they differ from the
  table's last day. Fetched every run, independent of NSE.
- World price (gold-api.com, current spot only): stored as today's point on weekdays; history
  builds from 21 Oct 2026.
- Tick boxes: Nifty 50; Gold in India (22K / 24K / GOLDBEES — they move by the same %); world
  gold. Indian gold solid yellow, world gold dashed yellow; table and tooltip show prices.

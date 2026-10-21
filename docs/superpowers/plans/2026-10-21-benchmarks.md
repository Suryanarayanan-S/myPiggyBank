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

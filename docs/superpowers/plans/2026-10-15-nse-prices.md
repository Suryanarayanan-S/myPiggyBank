# Daily prices from NSE

User ask: "fetch daily automatically from zerotha or some other place". Kite Connect needs a daily
login, so prices come from NSE's public end-of-day file ("sec_bhavdata_full_DDMMYYYY.csv",
no login, ~400 KB, every NSE-listed instrument). Quantities still come from Kite imports.

- Opt-in per family (`Family.livePrices`, off by default). Download nothing otherwise.
- `HoldingPrice.source`: `manual` (typed), `import` (from a holdings file), `nse` (downloaded).
  NSE closes replace `import`/`nse` prices of the same day, never `manual` ones.
- Latest available trading day: today, stepping back up to 7 days (weekends, holidays).
- Match: symbol exactly (series EQ/BE/GB/IV/…), else `SYMBOL-SERIES` (e.g. `SGBFEB32IV-GB`).
  Only open INR holdings with a symbol. Unmatched ones are reported (e.g. BSE-only shares).
- Every 6 hours from the server and "Update now"; one run at a time; status: as-of date,
  updated count, not found list, last error.
- Investments page: switch, status line, Update now.

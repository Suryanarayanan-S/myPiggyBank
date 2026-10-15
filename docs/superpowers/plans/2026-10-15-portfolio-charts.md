# Portfolio charts (Console-style)

User ask: donuts for account / sectors / stocks / market cap and contributors to returns, like
Zerodha Console.

- `InstrumentInfo` (symbol → industry, SEBI size group) from NSE's index lists (Nifty 500, 100,
  Midcap 150, Smallcap 250, Microcap 250), rebuilt at most monthly during the opt-in NSE price
  run; a failure is a `warning`, never a price error. `GET /holdings` items carry `industry`, `cap`.
- Overview donuts: Account (equity / gold / InvIT & other), Sectors, Market cap (shares only);
  top four groups + "Other" (≤ 5 slices), legend with shares, table view; a one-group split is
  not drawn. Colours follow the group (Gold always yellow, Large/Mid/Small fixed), validated with
  the dataviz palette script for light, dark and retro.
- Contributors to returns: top 5 performers and decliners by ₹ (summary currency).
- Stocks by weight stay as the "Biggest holdings" bars (87 slices would not read as a donut).

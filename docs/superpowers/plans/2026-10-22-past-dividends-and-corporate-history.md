# Past dividends and corporate-action history from NSE

Goal: every dividend (and InvIT distribution) since the first trade, worked out like Zerodha
does (shares held at the close before the ex-date × amount per share), plus a history of splits,
bonuses, demergers and mergers with what each did to the holding.

## Verified first (prototype, 22 Oct 2026)

NSE's `api/corporates-corporateActions?index=equities&symbol=…&from_date=…&to_date=…` returns the
history per symbol (one request each). Computed against the combined tradebook, 139 of the 140
payouts in Console's dividend reports (Oct 2024 → Oct 2026) match to the paisa (the 140th is the
same ₹2 under another symbol). Trades are stored in today's units, so units before a later
split/bonus are divided by its factor.

## Design

- CorporateAction gains `amount` (micros per share/unit) and kind `dividend`.
- `readNseHistory(json)`: dividends (sum of Rs amounts; "Distribution - Rs X" = X), split/bonus/
  consolidation via the existing purpose meaning, demerger/amalgamation/merger/arrangement as
  `review` (events). AGMs, buy-backs, bond interest ignored.
- Past dividends (preview/commit per person): per holding (incl. archived) and dividend action
  between its first trade and today, units held at the close before the ex-date (÷ later factors);
  skip when the person already has a payout of that amount that day (any holding: renamed
  symbols). Gold bonds: the last recorded interest repeated every six months back to the buy.
- History is fetched at most weekly per symbol (FetchMark `nse-history:SYM`).
- Events: per holding, split/bonus/consolidation/demerger/merger with units before/after and value
  before (close the day before) vs after (close on the ex-date, or the first close of a new
  share), from NSE's daily files, cached in MarketClose.

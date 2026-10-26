# Splits and bonus issues from NSE (corporate actions)

Goal: a split or bonus issue no longer shows as a big loss. Units and earlier prices of a held
holding are adjusted automatically on the ex-date; anything that cannot be adjusted safely is
flagged for the user to check.

## Findings (checked against real NSE files, Sep–Oct 2026)

- `sec_bhavdata_full` does NOT adjust PREV_CLOSE on an ex-date (0 adjusted rows in 20 days, while
  BUILDPRO, BANSALWIRE, BLSE, MOLDTECH, MOLDTKPAC fell to 1/5 or 1/2 overnight).
- NSE's daily `archives/equities/bhavcopy/pr/PRddmmyy.zip` holds `bcddmmyyyy.csv`
  (SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE),
  listing ex-dates from that day up to about a week ahead. Purposes seen:
  `FVSPLT FRM RS 10 TO RS 2`, `FV SPLT FRM RS10 TO RE1`, `BONUS 1:1`, `DEMERGER`.

## Design

- `domain/zip.ts`: read one entry of a zip (central directory, stored or deflate) — no dependency.
- `domain/corporateActions.ts`: `prName(day)`, `readCorporateActions(csv)` → split / bonus /
  consolidation with factor num/den (split from a to b: a/b; bonus a:b: (a+b)/b), or `review`
  (demerger, rights, capital reduction, amalgamation, scheme; a split that cannot be read).
  Dividends, interest, AGMs are ignored.
- Schema: `CorporateAction` (symbol, exDate, purpose, kind, num, den) and `HoldingAction`
  (holdingId, exDate, purpose, kind, status applied | review, num, den, unitsBefore, unitsAfter).
- Daily run (NSE on): fetch the PR zip of the latest day and of earlier days of the last week not
  yet fetched (remembered in memory); store actions; then for each held INR holding with a
  matching symbol and an action with ex-date ≤ the latest day, once:
  - nothing held the day before: skip;
  - `review`, or a buy/sell on/after the ex-date (an import may already show the new units):
    record `review`;
  - otherwise in one transaction: trades before the ex-date units × num/den, prices before it
    × den/num; record `applied` with units before/after.
- A close stored later for a day before an applied ex-date (backfill) is adjusted the same way.
- GET /holdings: each holding's actions. Investments page: notice of actions with an ex-date in
  the last 60 days (applied: units before → after; review: "check its units and cost").

## Tests

Zip reader, purpose parsing, service (applied, no double apply, review on later trade, demerger,
backfill adjusted, PR failure is a warning), frontend notice helper, e2e not possible offline
(unit-tested instead).

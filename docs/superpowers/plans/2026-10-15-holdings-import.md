# Zerodha holdings import, and counting investments at value or cost

User asks: import `holdings.csv` (Zerodha Kite) into Investments; an option whether net worth uses
the invested amount or the current value.

- `POST /holdings/import/preview|commit` `{ fileName, data, ownerMemberId, retireAssetId?, sellMissing? }`.
  New symbols → holding (INR, kind guessed) with a buy today (units, invested) and today's price;
  existing (same owner, INR, symbol ignoring `NSE:`/`.NS`) → buy or sell the difference, price
  upserted; missing ones listed and optionally sold at their last price; a manual INR investment
  asset can be retired with a 0 valuation today (history kept). Reads and writes in one transaction.
- `Family.investmentsAt` (`value` | `invested`): what holdings count with in net worth and goals;
  chosen on the Investments page.
- Migration order: `20261015090000_investments_at` sorts after `20261015080000_remove_money_story`.

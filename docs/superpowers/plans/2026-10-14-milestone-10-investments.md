# Milestone 10 — Investments

**Spec:** `docs/superpowers/specs/2026-10-14-mypiggybank-v2-features-design.md` (M10).

## Model

- `Holding`: familyId, name (≤ 60), `kind` (`stock` | `etf` | `fund` | `gold` | `other`),
  `symbol?` (ticker/ISIN ≤ 20), `currency`, `ownerMemberId?`, `accountId?` (the depot it sits
  in, informational), `note?`, `archived`.
- `HoldingTrade`: holdingId, date, `type` (`buy` | `sell` | `dividend`), `units` (micro-units,
  BigInt, > 0 for buy/sell, 0 for dividends), `amount` (minor units: total paid for a buy,
  received for a sell or dividend), `fees` (minor units ≥ 0).
- `HoldingPrice`: holdingId, date, `price` (micros of the currency per unit: €98.4567 →
  98_456_700). One per holding and date (unique), replaced when entered again.

Units and prices use micros so fractional ETF shares and 4-decimal prices are exact.

## Rules (domain `computeHolding`, pure)

- Trades in date order (then creation order). Average-cost method:
  - buy: units += u; cost += amount + fees.
  - sell: share = u / units; costOut = round(cost × share); realised += amount − fees − costOut;
    cost −= costOut; units −= u. Selling more than held is refused by the API.
  - dividend: dividends += amount.
- Price: the newer of the latest `HoldingPrice` on or before today and the latest buy/sell price
  (amount / units); on the same day the entered price wins. A trade price is reported with
  `priceSource: 'trade'`. No price and no trades → value null; nothing held → no net-worth item.
- Ruling (review): archived holdings keep counting towards goals, like archived accounts; a buy
  inside the pace window counts as saving (money moved in), unlike an asset first entered today.
- value = round(units × price); unrealised = value − cost; returnBp = unrealised / cost.
- Net worth: each non-archived holding with a value counts in the _investment_ class for its
  owner, in its currency (converted like other holdings). Ruling: no "depot" flag — an account
  holds cash, holdings hold securities; nothing is counted twice unless the user also books the
  securities' value into the account, which the docs advise against.
- Goals can link holdings (`kind: 'holding'`, current value; before = value at the cutoff using
  the price then, with today's rate).

## API

`GET /holdings?currency=` → `{ holdings: [...computed], summary: { currency, value, invested,
unrealised, realised, dividends, byKind, byMember, unconverted } }` (default currency: wealth);
`POST /holdings`, `PUT/DELETE /holdings/:id`; `POST /holdings/:id/trades`,
`DELETE /holdings/:id/trades/:tradeId`; `POST /holdings/:id/prices`,
`DELETE /holdings/:id/prices/:priceId`.

## Tasks

1. Domain `computeHolding` + unit parsing helpers; tests (partial sells, fees, dividends, price
   fallback, rounding, sell-all).
2. Schema + migration, service + routes, net-worth and goals integration; API tests (scoping,
   oversell refused, conversion, archived excluded, currency locked once traded).
3. Frontend: Investments page (summary, allocation, holdings table, holding dialog with trades
   and prices), units/price inputs; e2e with screenshots (modern light/dark, retro).

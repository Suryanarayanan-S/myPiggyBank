# Investments dashboard (Console-style)

User ask: "have a dashboard for investment like zerodha console".

- Investments page tabs: Overview (biggest holdings by weight, top gainers/losers, value over
  time from price points and trades, by kind / by person) and Holdings (sortable, searchable
  broker-style table with totals; sold-out holdings below).
- `GET /holdings` items carry `inView` (value and cost in the summary currency) so weights and
  totals compare like with like; holdings without a rate are listed in their own currency.
- Numbers in the holding currency's style (₹ en-IN), prices to two decimals in lists.

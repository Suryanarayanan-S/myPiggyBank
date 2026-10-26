# World market (Trade Republic) — plan

Goal: euro holdings from a Trade Republic export get what the Indian ones have — daily prices,
dividends, splits — and the two comparison cards work for them against euro markets.

## Decisions

- **Broker account** = an open account of the type Investment in the holdings' currency (e.g.
  "Trade Republic", EUR). Its owner decides whose the holdings are (same rule as a demat).
- **Import** (`domain/tradeRepublic.ts`, `services/tradeRepublicService.ts`): Trade Republic's
  transactions CSV (`datetime,date,account_type,category,type,asset_class,name,symbol,shares,
  price,amount,fee,tax,currency,…,transaction_id,…`). TRADING BUY/SELL and CASH DIVIDEND rows
  become trades of holdings keyed by ISIN (`symbol`); cash transfers, interest and card rows are
  counted and left out. Each row's `transaction_id` is stored on the trade (`HoldingTrade.ref`,
  unique per holding): an overlapping export adds only what is new. Buys: amount = −amount, fees
  = −fee. Sells: amount, fees = −fee (tax on gains left out). Dividends: gross amount; the tax
  withheld is kept as the dividend's `fees` (ignored by the holding maths, like Indian TDS).
  A row before an applied split comes in scaled to the new units.
- **Prices** (`domain/onvista.ts`, `services/worldPriceService.ts`): onvista's public JSON (search
  by ISIN → instrument; snapshot → venues and split list; `eod_history` → daily closes). The venue
  quoted in the holding's currency is chosen: Tradegate, LS Exchange, gettex, Xetra, Frankfurt.
  Resolution cached in `WorldInstrument` (refreshed monthly). Each run: closes since the last
  stored one (from the first trade), source `onvista`, never over a manual price. Only for
  families with daily prices on. Unofficial endpoint: failures are said, prices kept.
- **Splits**: onvista's split list (date, factor) → `HoldingAction` like NSE's: trades before
  the date × factor, non-onvista prices before it ÷ factor (onvista history is already adjusted).
- **Euro benchmarks** (BenchmarkPoint): ETFs bought in euros — MSCI World (IE00B4L5Y983), S&P 500
  (IE00B5BMR087), Nasdaq 100 (IE00B53SZB19), STOXX Europe 600 (DE0002635307), Nikkei 225
  (LU0839027447), Xetra-Gold (DE000A0S9GB0). From 2020-01-01, then daily.
- **Cards**: SameMoney and ValueOverTime pick their markets by currency (INR: Nifty 50 and gold;
  EUR: the ETFs). With holdings in both, a ₹ / € switch picks which holdings are compared.
  Palette: categorical slots 5–8 added (validated light and dark).
- **Dividends tab**: payouts of every currency, each with its currency.

## Steps (test-first, one commit)

1. Schema: `HoldingTrade.ref`, `WorldInstrument`; migration (`--create-only`, sorts last).
2. Parser + import service + routes; tests with the real file's shape (made-up values).
3. onvista reader + world price service (prices, splits, benchmarks), fetch injected; tests.
4. Server wiring after the NSE run; status says what failed.
5. Frontend: import dialog, currency-aware cards, payouts currency, palette.
6. Check, e2e, review, deploy (backup first).

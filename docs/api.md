# API

All endpoints are under `/api`, take and return JSON, and (except register, login and health)
need the session cookie from logging in. Answers are `{ "data": … }` or
`{ "error": { "code", "message", "details" } }`. Money is in minor units (cents/paise); dates are
`YYYY-MM-DD`, months `YYYY-MM`.

Common errors: `400 VALIDATION_ERROR` (with `details[].path`), `401 UNAUTHENTICATED`,
`403 CROSS_ORIGIN_REQUEST`, `404 NOT_FOUND` (also for another family's ids), `409` (e.g.
`CONFLICT`, `CATEGORY_IN_USE`, `CURRENCY_LOCKED`), `429 RATE_LIMITED`.

Read endpoints marked **(currency)** accept `?currency=EUR|INR|USD|GBP|CHF|AUD|CAD|SGD` to show
the money in that currency instead of the default.

## Auth and family

| Method                    | Path                       | Notes                                                                                                                                                  |
| ------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST                      | `/auth/register`           | `{ name, email, password, familyName? }` — first user creates the family. Rate-limited.                                                                |
| POST                      | `/auth/login`              | `{ email, password }`. Rate-limited.                                                                                                                   |
| POST                      | `/auth/logout`             |                                                                                                                                                        |
| GET                       | `/auth/me`                 | `{ user, family }`                                                                                                                                     |
| DELETE                    | `/auth/account`            | `{ password, confirm: "DELETE" }`; deletes the family if you were the last user. Rate-limited.                                                         |
| GET / PUT                 | `/family`                  | name, `spendingCurrency`, `wealthCurrency`, `rateMode` (`manual` / `live`), `targets`, `bucketNames`, `extras` (`moneyStory`, `quickEntrySuggestions`) |
| GET / POST / PUT / DELETE | `/members`, `/members/:id` | family members (labels for transactions)                                                                                                               |

## Money in and out

| Method                    | Path                                 | Notes                                                                                                                                                                      |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST / PUT / DELETE | `/accounts`, `/accounts/:id`         | currency locked once used                                                                                                                                                  |
| GET                       | `/accounts/total` **(currency)**     | open accounts together; default wealth currency                                                                                                                            |
| GET / POST / PUT / DELETE | `/categories`, `/categories/:id`     | expense categories have a bucket                                                                                                                                           |
| GET                       | `/transactions` **(currency)**       | filters `from, to, type, accountId` (`none` = without an account)`, categoryId, memberId, q`, `sort, order, page, pageSize`; returns `totals` per currency and `converted` |
| POST / PUT / DELETE       | `/transactions`, `/transactions/:id` | transfers need `transferAccountId` (and `transferAmount` across currencies)                                                                                                |
| GET                       | `/export/transactions.csv`           | same filters as the list (`from`, `to` required)                                                                                                                           |
| GET / POST / PUT / DELETE | `/recurring`, `/recurring/:id`       | rules; `POST /recurring/run` creates what is due; `GET /recurring/upcoming?days=30`                                                                                        |

## Budget

| Method    | Path                                  | Notes                                                                                          |
| --------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET       | `/budget/:month` **(currency)**       | buckets, categories, limits, `limitsEditable`, `unconvertedLimits`                             |
| PUT       | `/budget/:month/limits`               | `{ limits: [{ categoryId, amount \| null }] }` (spending currency)                             |
| POST      | `/budget/:month/copy-previous`        | copy last month's limits                                                                       |
| GET / PUT | `/month-entry/:month?accountId=`      | the quick-entry grid (one amount per category; rows carry `lastMonth` and `usual` suggestions) |
| GET       | `/dashboard?from=&to=` **(currency)** | period totals, months, categories, members, `accountsTotal`                                    |

## Wealth

| Method                    | Path                                                            | Notes                                                               |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET / POST / PUT / DELETE | `/assets`, `/assets/:id`                                        |                                                                     |
| POST / DELETE             | `/assets/:id/valuations`, `/assets/:id/valuations/:subId`       | value history                                                       |
| GET / POST / PUT / DELETE | `/liabilities`, `/liabilities/:id`                              |                                                                     |
| POST / DELETE             | `/liabilities/:id/balances`, `/liabilities/:id/balances/:subId` | outstanding history                                                 |
| GET                       | `/net-worth` **(currency)**                                     | current split by member and class, snapshots, month/year comparison |
| POST / PUT / DELETE       | `/net-worth/snapshots`, `/net-worth/snapshots/:id`              | `{}` = today; `{ date, netWorth }` = a past entry                   |

## Goals

| Method                    | Path                                                | Notes                                                                                                                                                          |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST / PUT / DELETE | `/goals`, `/goals/:id`                              | target, currency, date, member, `links: [{ kind: account \| asset \| holding, id }]`, status; list includes `saved`, `progress` (pace, monthly need, on track) |
| POST / DELETE             | `/goals/:id/entries`, `/goals/:id/entries/:entryId` | money kept elsewhere (negative = taken out); currency locked once there are entries                                                                            |

## Investments

| Method              | Path                                                  | Notes                                                                                                                   |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET                 | `/holdings` **(currency)**                            | holdings with units, average cost, price, value, gain/loss, realised, dividends; `summary` by kind and person           |
| POST / PUT / DELETE | `/holdings`, `/holdings/:id`                          | currency locked once there are trades                                                                                   |
| POST / DELETE       | `/holdings/:id/trades`, `/holdings/:id/trades/:subId` | `{ date, type: buy \| sell \| dividend, units: "12.5", amount, fees }`; selling more than held → 409 `NOT_ENOUGH_UNITS` |
| POST / DELETE       | `/holdings/:id/prices`, `/holdings/:id/prices/:subId` | `{ date, price: "98.45" }` per unit; same date replaces                                                                 |

## Reports and insights

| Method | Path                                     | Notes                                                                                               |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/reports/year/:year` **(currency)**     | months, totals, averages, last year (same months, `label`), categories, people, net worth start/end |
| GET    | `/reports/year/:year.csv` **(currency)** | the same as a spreadsheet                                                                           |
| GET    | `/insights` **(currency)**               | observations `{ id, kind, tone, data, link }` for this month and the six before                     |

## Exchange rates

| Method    | Path                           | Notes                                               |
| --------- | ------------------------------ | --------------------------------------------------- |
| GET / PUT | `/exchange-rates`              | hand-entered `{ month, base, quote, rate }`         |
| DELETE    | `/exchange-rates/:id`          |                                                     |
| GET       | `/exchange-rates/live`         | `{ asOf, fetchedAt, lastError }`                    |
| POST      | `/exchange-rates/live/refresh` | download now (503 if the server has no rate source) |

## Import

| Method | Path                                                               | Notes                                                               |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| POST   | `/import/spreadsheet/preview`, `/import/spreadsheet/commit`        | monthly-spending workbook (base64)                                  |
| POST   | `/import/csv/preview`, `/import/csv/analyze`, `/import/csv/commit` | bank statement CSV: columns, duplicates, suggestions, learned rules |

## Other

`GET /health` — `{ "data": { "status": "ok" } }` when the database answers; used by Docker.

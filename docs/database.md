# Database

One SQLite file managed by Prisma (`backend/prisma/schema.prisma`, migrations in
`backend/prisma/migrations/`). Every table except `LiveRate` belongs to a family and is deleted
with it. Money columns are integers in minor units (BigInt where crores are possible).

```
Family ─┬─ User ── Session
        ├─ FamilyMember (optional link to a User)
        ├─ Account ── Transaction ── Category (bucket: essentials | fun | future)
        │                 └─ RecurringRule (creates transactions)
        ├─ CategoryLimit (per month, own currency)
        ├─ CategoryRule (learned "text → category" from bank imports)
        ├─ ExchangeRate (hand-entered, per month)
        ├─ Asset ── AssetValuation
        ├─ Liability ── LiabilityBalance
        └─ NetWorthSnapshot
LiveRate (public ECB rates, shared)
```

## Tables

| Table                            | What it holds                                                                                        | Notes                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Family`                         | name, `spendingCurrency` (EUR), `wealthCurrency` (INR), `rateMode`, 50/30/20 targets                 |                                                                                                   |
| `User`                           | email, argon2id hash, role                                                                           | email unique                                                                                      |
| `Session`                        | SHA-256 of the cookie token, expiry                                                                  | expired ones are swept at login                                                                   |
| `FamilyMember`                   | names used on transactions, accounts, assets                                                         | null member = "Shared"                                                                            |
| `Account`                        | name, type, currency, opening balance, owner, asset class, archived                                  | currency locked once it has transactions                                                          |
| `Category`                       | name, kind (income/expense), bucket, order                                                           |                                                                                                   |
| `Transaction`                    | date, amount (> 0), type (income/expense/transfer), account, category, member, merchant, notes, tags | `isMonthlyTotal` for quick-entry rows; `importBatch` for imports; `recurringRuleId` + date unique |
| `CategoryLimit`                  | monthly limit per category                                                                           | `currency` = spending currency when set                                                           |
| `CategoryRule`                   | lowercase text pattern → category                                                                    | learned in bank import                                                                            |
| `RecurringRule`                  | name, amount, frequency, start/end, `generateFrom`, `generatedThrough`                               | the watermark stops re-creating deleted rows                                                      |
| `ExchangeRate`                   | month, base, quote, `rateMicros`                                                                     | one per family, month and pair                                                                    |
| `LiveRate`                       | month, quote (1 EUR = …), `rateMicros`, ECB date, `final`                                            | not family data; final = month-end, never refetched                                               |
| `Asset` / `AssetValuation`       | property, gold, depots… and dated values                                                             | currency locked once valued                                                                       |
| `Liability` / `LiabilityBalance` | loans and dated outstanding amounts                                                                  |                                                                                                   |
| `NetWorthSnapshot`               | dated net worth (with assets/liabilities and breakdown when taken today)                             | in the wealth currency of the time                                                                |

## Changing the schema

1. Edit `schema.prisma`.
2. `npm run prisma -w backend -- migrate dev --create-only --name <what>` and read the SQL.
   SQLite redefines tables for many changes: make sure existing rows are copied (backfill new
   required columns in the `INSERT … SELECT`).
3. Test it on a copy of a real backup before release:
   `DATABASE_URL=file:/path/copy.db npx prisma migrate deploy` (from `backend/`).
4. Never edit a migration that has been applied anywhere: its checksum would change.

Docker applies pending migrations at start; back up first (`npm run backup`).

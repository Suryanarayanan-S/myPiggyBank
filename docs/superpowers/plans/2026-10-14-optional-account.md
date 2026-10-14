# Transactions without an account

User ask: "add the transaction without setting the account, account can be optional".

## Design

- `Transaction.accountId` becomes nullable; a new required `Transaction.currency` column holds the
  money's currency for every row (migration backfills it from the account).
- With an account, the currency is always the account's (a sent currency must match it).
  Without one, the currency is the one sent, else the family's spending currency.
- Transfers still need both accounts. Quick entry, recurring rules and bank import keep their
  account (they are about an account by nature).
- Readers (budget, dashboard, reports, insights, list totals, export) use `t.currency`; balances
  skip rows without an account. The list shows "—" for the account; the filter "No account"
  finds them.
- Frontend form: account select gets "No account"; then a currency select appears (default
  spending currency).

## Tasks

1. Schema + migration with backfill; every writer sets `currency`.
2. Service/validation + API tests (create/edit without account, currency rules, totals, balances).
3. Readers switched to `t.currency`; tests stay green.
4. Frontend form, list, filter; unit + e2e.

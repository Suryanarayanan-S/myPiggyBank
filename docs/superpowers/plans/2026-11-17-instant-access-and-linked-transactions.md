# Instant-access savings and transactions linked to deposits

## What the user asked
Three kinds of deposits — fixed (e.g. a year), recurring, and instant-access savings with daily
interest — and from a transaction, say which deposit it belongs to, so it shows in Deposits.

## Decisions
- New deposit kind `savings` (tab "Instant access"). No maturity: `Deposit.maturityDate` becomes
  nullable (Prisma-generated table redefinition, reviewed by hand).
- Its balance: the opening amount on the start day, plus money linked in (an expense from a bank
  account), minus money linked out (income into a bank account).
- Interest accrues every day on the day's closing balance at the rate of that day (rate/365), and
  is credited at the start of each calendar month / quarter / half-year / year (`compounding`,
  default monthly), rounded to the cent when credited. Worth today = balance + interest credited
  + interest accrued so far.
- The rate is variable: `Deposit.rateHistory` (JSON `[{from, rateBp}]`). Changing the rate asks
  "from which day"; earlier interest keeps the old rate.
- `Transaction.depositId` (nullable, set null when the deposit is deleted). Only income and
  expenses can be linked, in the deposit's currency.
- Every deposit lists its linked transactions (a recurring deposit also its booked instalments).
  Fixed and recurring deposits keep being valued from their terms; "Mark as paid out" takes the
  date of a linked income if there is one.
- Instant-access savings count as liquid in net worth by default.

## Steps (test first)
1. `savingsValue` in `domain/deposits.ts` with unit tests (daily accrual, monthly credit, rate
   change, withdrawals, before start).
2. Migration + schema; depositService (create/update/list/depositValues for savings, movements in
   the dto); transactionService (`depositId` validate + dto). Service tests.
3. Frontend: types, tab + route, page rows, form, transaction form "Deposit" select, overview
   guard for no maturity. Unit tests for helpers.
4. E2E: open an instant-access deposit, link a transaction, see the balance.

# Milestone 8 — Polish, demo data, docs

**Goal:** Finish v1: safer edges, demo data, and the docs needed to run, move and restore the app.

**Spec:** `docs/superpowers/specs/2026-10-07-mypiggybank-v1-design.md` (Revision 1.1) — "Demo data",
"Ops", "M8 E2E, docs, polish".

## Tasks

1. **Limits remember their currency** — `CategoryLimit.currency` (backfilled from the family's
   spending currency); budget converts each limit from its own currency; new limits are stored
   in the current spending currency.
2. **Sessions and cache** — logout clears the cookie with the same attributes it was set with;
   re-login deletes the old session; expired sessions are swept; the client query cache is
   cleared on login/logout/401; `DELETE /auth/account` is rate-limited.
3. **Errors and races** — a Prisma unique-constraint race (`P2002`) becomes 409 `CONFLICT`, not 500.
   Transaction paging gets a stable `id` tiebreaker.
4. **Dates in the user's time zone** — server "today" uses `TZ` (compose sets `Europe/Berlin`),
   so recurring rules and snapshots around midnight land on the right day.
5. **Data-loss guards** — confirm before deleting valuation/balance history; import "Replace"
   keeps rows edited after import; restore checks integrity (`PRAGMA quick_check`) and copies
   atomically; `--force` parsed strictly.
6. **Exchange-rate follow-ups** — single-flight refresh; month counted final only if fetched ≥ 3
   days after month end; month/year comparison is null if the nearest snapshot cannot be
   converted; rates indexed per pair (fast lookups); net worth loads rates once.
7. **Small UI fixes** — categories card keeps the typed name on error and refreshes transactions on
   rename; import mapping totals use the family currency; export honours the page filters.
8. **Demo data** — `npm run seed:demo` creates a clearly labelled demo family (12 months, EUR + INR,
   assets, loan, snapshots, rates). It never touches other families; `--reset` recreates it.
9. **Docs** — `docs/architecture.md`, `docs/api.md`, `docs/database.md`,
   `docs/moving-and-restoring.md`; README fixes (`npm start` uses `dev.db`, `npm ci`).

## Deliberately left (cosmetic or low effect)

Chart axis spacing and clamping, compact-number edge rounding, tab arrow keys, mobile More-menu
focus order, CSV UTF-16, search with non-ASCII case, word-boundary rule matching, 1-second backup
names, 4xx code names, React key collisions, cross-pair precision (~2e-5). Rate-limit bucket per
client IP is handled with family access (milestone after features).

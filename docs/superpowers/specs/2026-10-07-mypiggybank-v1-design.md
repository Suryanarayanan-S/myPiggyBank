# myPiggyBank v1 — Design Spec

Date: 2026-10-07
Status: Draft — awaiting review

## 1. Purpose

A simple personal/family finance web app. One place to see, each month:
how much came in, how much went out, how much was saved, whether the budget
is under control, and how net worth is changing over time.

**Users (v1):** one person, on one laptop (localhost).
**Later:** family members on the home network, same codebase.

**Success criteria for v1**

- Can record a month of real income/expenses in a few minutes (manually or via CSV).
- Dashboard answers "income / expenses / savings / savings rate / net worth" at a glance.
- Budget shows budget vs actual per category with a clear over-budget warning.
- Project can be cloned and running on another laptop with ~3 commands.
- Data can be backed up and restored to another machine.

## 2. Scope

### In v1

| Area           | Features                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth           | Register (first user creates the family), login, logout.                                                                                                                                                                                                                                                                                                                            |
| Family members | Add/edit members (e.g. Me, Spouse, Child) + implicit "Shared". Members are labels for transactions, not logins (yet).                                                                                                                                                                                                                                                               |
| Accounts       | Types: current, savings, tagesgeld, cash, credit card, investment, other. Opening balance; current balance = opening + sum of transactions.                                                                                                                                                                                                                                         |
| Categories     | Default seeded set (Housing, Groceries, Transport, Baby, Dining, Entertainment, Utilities, Insurance, Subscriptions, Salary, Bonus, Interest, Other…), type income/expense, editable, optional parent for subcategories.                                                                                                                                                            |
| Transactions   | Add / edit / delete. Fields: date, amount, type (income/expense/transfer), category, account, member, merchant, notes, tags. List with search, filter (month, type, category, account, member), sort.                                                                                                                                                                               |
| Budget         | Monthly amount per expense category. Shows budget, actual, remaining, % used, progress bar, warning when > 100%. "Copy previous month".                                                                                                                                                                                                                                             |
| Dashboard      | Period selector (this month, last month, last 3 months, this year). Cards: net worth, cash & bank, total assets, total liabilities, income, expenses, savings, savings rate. Charts: income vs expenses (12 months), expenses by category, net worth over time. Budget summary. Spending by member.                                                                                 |
| Net worth      | Manual assets (property, vehicle, gold, pension, other) with valuation history; liabilities (mortgage, car loan, personal loan, other) with original/outstanding amount, rate, monthly payment, lender, and balance history. Net worth = account balances + assets − liabilities. Monthly snapshot (taken on demand and automatically when the dashboard is opened in a new month). |
| CSV import     | Upload → preview → column mapping (date, description, amount, category optional) → validation errors shown per row → duplicate detection (same account + date + amount + description) → confirm. Nothing written before confirm. Rule-based category suggestion (merchant keyword → category, e.g. REWE → Groceries, NETFLIX → Subscriptions).                                      |
| Demo data      | Optional `npm run seed:demo` with clearly labelled demo family.                                                                                                                                                                                                                                                                                                                     |
| Ops            | `scripts/setup.sh`, `npm run backup`, `npm run restore <file>`.                                                                                                                                                                                                                                                                                                                     |

### Later (not v1), in planned order

1. Recurring transactions (auto-create due transactions).
2. Investments: securities, holdings, buy/sell/dividend, manual prices, P/L, allocation.
3. Goals with progress.
4. Reports + CSV export.
5. Financial insights (computed from data, no advice).
6. Multi-currency conversion (schema is ready; v1 assumes one display currency).
7. Family logins with roles; home-network access.

### Explicitly out of scope

2FA, audit log, XIRR, PDF export, AI categorisation, live market data, public internet hosting.

## 3. Architecture

```
Browser ── React SPA (Vite) ──HTTP/JSON──> Fastify API ──Prisma──> SQLite file
```

- **frontend/** — React 18 + TypeScript (strict) + Vite + Tailwind CSS + Recharts + lucide-react. TanStack Query for server state, React Router for routing. Sidebar on desktop, bottom nav on mobile. Light/dark mode.
- **backend/** — Node 22 + Fastify + TypeScript (strict). zod validation on every request. Layers: `routes/` (HTTP) → `services/` (business logic) → Prisma. Pure calculation functions (`domain/`) for balances, budget, net worth, CSV parsing, categorisation — unit-tested without a DB.
- **Database** — SQLite via Prisma, file at `data/piggybank.db` for the Docker/real instance and `data/dev.db` for local development (both git-ignored). Switching to PostgreSQL later = change Prisma provider + `DATABASE_URL`.
- **Dev:** `npm run dev` runs API (port 3001) and Vite (port 5173, proxies `/api`). **Prod-like:** `npm run build && npm start` — Fastify serves built frontend on one port.
- npm workspaces at the repo root (`frontend`, `backend`).

## 4. Data model (v1)

All IDs are UUIDs. All tables have `createdAt`/`updatedAt`. Every domain row has `familyId`, and every query filters by the logged-in user's `familyId` (user isolation).

Money: stored as **integer minor units** (cents) + `currency` (ISO code, default `EUR`). No floats.

- **Family** — id, name, baseCurrency
- **User** — id, familyId, email (unique), passwordHash, name, role (`owner` | `member`)
- **Session** — id, userId, expiresAt (server-side sessions)
- **FamilyMember** — id, familyId, name, userId? (link for later logins)
- **Account** — id, familyId, name, type, currency, openingBalance, archived
- **Category** — id, familyId, name, kind (`income` | `expense`), parentId?, color
- **Transaction** — id, familyId, accountId, date, amount (positive), type (`income` | `expense` | `transfer`), categoryId?, memberId? (null = Shared), merchant, notes, tags (string), transferAccountId?, importHash?
  - indexes: (familyId, date), (familyId, categoryId), (accountId, date), (familyId, importHash)
- **Budget** — id, familyId, month (`YYYY-MM`), unique(familyId, month)
- **BudgetItem** — id, budgetId, categoryId, amount
- **CategoryRule** — id, familyId, pattern, categoryId (for CSV auto-categorisation)
- **Asset** — id, familyId, name, type, currency, notes
- **AssetValuation** — id, assetId, date, value
- **Liability** — id, familyId, name, type, currency, originalAmount, interestRate, monthlyPayment, startDate, endDate, lender, notes
- **LiabilityBalance** — id, liabilityId, date, outstanding
- **NetWorthSnapshot** — id, familyId, month, assets, liabilities, netWorth, unique(familyId, month)

## 5. Key calculations

- Account balance = openingBalance + Σ income − Σ expense ± transfers (in/out).
- Monthly income/expenses = sum of income/expense transactions in the period (transfers excluded).
- Savings = income − expenses; savings rate = savings / income (shown as "—" if income is 0).
- Budget actual = Σ expenses in the month for that category **and its subcategories**; remaining = budget − actual; % used = actual / budget.
- Net worth = Σ account balances (credit card balances negative) + Σ latest asset valuation − Σ latest liability outstanding.

## 6. API (all JSON, under `/api`, all except auth require a session)

Response shape: `{ data }` on success, `{ error: { code, message, details? } }` on failure.

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PUT/DELETE /members`, `/accounts`, `/categories`, `/transactions`, `/assets`, `/liabilities`
- `POST /assets/:id/valuations`, `POST /liabilities/:id/balances`
- `GET /budgets/:month`, `PUT /budgets/:month`, `POST /budgets/:month/copy-previous`
- `GET /dashboard?from&to`
- `GET /net-worth` (current + snapshots), `POST /net-worth/snapshot`
- `POST /import/preview` (multipart CSV + mapping → rows with validation, duplicate flags, suggested categories), `POST /import/commit`

## 7. Security (localhost scope)

- Passwords hashed with argon2id.
- Server-side sessions; httpOnly, SameSite=Strict cookie (Secure flag when served over HTTPS).
- SameSite=Strict + JSON-only API covers CSRF for this scope.
- zod validation of all input; Prisma parameterised queries; React escapes output.
- Every query scoped by `familyId`; tests verify one family cannot read another's data.
- Simple login rate limit (@fastify/rate-limit on auth routes).
- Server binds to `127.0.0.1` by default (`HOST` env var to change later).
- Secrets only in `.env` (git-ignored); `.env.example` committed.

## 8. Portability & Git

- Repo: `git@github.com:Suryanarayanan-S/myPiggyBank.git`.
- `.gitignore`: `node_modules`, `.env`, `data/`, `dist/`, backups.
- New laptop: install Node 22 (nvm) → `git clone` → `./scripts/setup.sh` → `npm run dev`.
- Data moves separately: `npm run backup` writes `backups/piggybank-YYYYMMDD-HHMM.db`; `npm run restore <file>` restores it.

## 8a. Docker

Two separate Docker setups live in the repo:

**Runtime container** (daily use, other laptops, later a home server)

- Multi-stage `Dockerfile`: build frontend + backend, then a slim Node 22 image that runs the API and serves the built frontend. Runs as non-root `node` user; applies Prisma migrations on start; has a health check.
- `docker-compose.yml`: one service, port `127.0.0.1:8080 → 3001` (host-only), data bind-mounted from `./data` so the database lives on the host and survives rebuilds. Config via `.env` interpolation.
- `.dockerignore` keeps `node_modules`, `.env`, `data/`, `backups/` out of the image.
- Database files are separated: Docker (real data) uses `data/piggybank.db`; local development uses `data/dev.db`, so experiments never touch real data.

**Dev container** (coding on any laptop with only Git + Docker + VS Code)

- `.devcontainer/devcontainer.json` based on `mcr.microsoft.com/devcontainers/typescript-node` (Node 22), runs `scripts/setup.sh` after creation, forwards ports 5173 and 3001, and installs ESLint, Prettier, Prisma and Tailwind VS Code extensions.
- Native Node development on the host (via nvm) remains supported; both use the same scripts.

## 9. Testing

- **Vitest unit tests** for `domain/`: balances, monthly totals, savings rate, budget calc (incl. subcategories, over-budget), net worth, CSV parsing/validation, duplicate detection, categorisation rules.
- **API integration tests** (Vitest + Fastify `inject` + temporary SQLite DB): register/login/logout, transaction create/edit/delete, authorization & family isolation.
- **Playwright** (added once UI is in place): register → create account → add income → add expense → set budget → view dashboard → add asset → view net worth.
- ESLint + Prettier; TypeScript strict; `npm run check` runs lint + typecheck + tests.

## 10. Build order (each step = working app + tests + commit)

1. Repo, tooling, frontend + backend skeleton, Prisma + SQLite, health check, setup script, runtime Docker + dev container.
2. Auth + family members.
3. Accounts, categories, transactions (list/search/filter/sort).
4. Budgets.
5. Assets, liabilities, net worth + snapshots.
6. Dashboard.
7. CSV import with rule-based categorisation; demo seed; backup/restore.
8. Playwright E2E, README + docs polish.

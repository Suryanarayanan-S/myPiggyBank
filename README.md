# myPiggyBank

A simple, private family-finance app: income, expenses, budgets, accounts and net worth — running on your own machine.

> Status: Milestones 1–7 (login, family, accounts, transactions, EUR/INR, 50/30/20 budget, quick entry, spreadsheet + bank CSV import, dashboard, family wealth, recurring transactions, backup/restore). See `docs/superpowers/specs/` for the v1 design.

New here? Open [docs/how-it-works.html](docs/how-it-works.html) in your browser for a picture guide to how the app works, from the screen to the database, and the tools behind each part.

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, lucide-react
- **Backend:** Node 22, Fastify 5, TypeScript, zod, Prisma 6
- **Database:** SQLite (a single file in `data/`; switchable to PostgreSQL via Prisma)
- **Tests:** Vitest

## Prerequisites

- Node.js 22 (recommended via [nvm](https://github.com/nvm-sh/nvm): `nvm install` in this folder)
- Git

## Getting started (any laptop)

```bash
git clone git@github.com:Suryanarayanan-S/myPiggyBank.git
cd myPiggyBank
nvm install          # uses .nvmrc → Node 22
./scripts/setup.sh   # creates .env, installs dependencies, creates the database
npm run dev
```

Open **http://localhost:5173**, click **Create one**, and register. After creating your account you can set `ALLOW_REGISTRATION=false` in `.env`.

## Run with Docker (daily use)

```bash
docker compose up -d --build   # build & start in the background
```

Open **http://localhost:8080**. Your data is stored on your disk in `data/piggybank.db` — rebuilding or removing the container never deletes it.

| Command                        | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `docker compose up -d --build` | Build (after `git pull`) and start                        |
| `docker compose logs -f`       | Follow logs                                               |
| `docker compose down`          | Stop (data is kept)                                       |
| `npm run docker:smoke`         | Build + automated smoke test against a temporary data dir |

Development (`npm run dev`) uses a separate database, `data/dev.db`, so experiments never touch your real data.

## Develop in a Dev Container (no Node install needed)

Requirements: Git, Docker, and VS Code with the **Dev Containers** extension.

1. Open the folder in VS Code → **Reopen in Container**.
2. Wait for setup to finish (it runs `scripts/setup.sh`).
3. In the container terminal: `npm run dev` → the browser opens http://localhost:5173.

## Commands

| Command                               | What it does                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                         | API on :3001 + web on :5173 with hot reload          |
| `npm run build && npm start`          | Production mode: one server on http://localhost:3001 |
| `npm test`                            | Backend + frontend tests                             |
| `npm run check`                       | Lint + typecheck + tests                             |
| `npm run format`                      | Prettier                                             |
| `npm run db:migrate`                  | Apply database migrations                            |
| `npm run backup` / `npm run restore`  | Back up / restore the database (see below)           |
| `npm run e2e`                         | Browser tests (Playwright) with screenshots          |
| `npm run prisma -w backend -- studio` | Browse the database                                  |

## Environment variables (`.env`)

| Variable             | Default                  | Meaning                                                     |
| -------------------- | ------------------------ | ----------------------------------------------------------- |
| `HOST`               | `127.0.0.1`              | Interface to listen on (this laptop only)                   |
| `PORT`               | `3001`                   | API / production port                                       |
| `DATABASE_URL`       | `file:../../data/dev.db` | Development SQLite file (relative to `backend/prisma/`)     |
| `COOKIE_SECURE`      | `false`                  | `true` when served over HTTPS (also enables HTTPS upgrades) |
| `ALLOW_REGISTRATION` | `true`                   | Allow new accounts                                          |
| `SESSION_DAYS`       | `30`                     | Login session lifetime                                      |

## Your data, backups and moving to another laptop

Your real data (Docker) lives in `data/piggybank.db`; development uses `data/dev.db`. Neither is ever committed to Git.

```bash
npm run backup                              # → backups/piggybank-YYYYMMDD-HHMMSS.db (safe while the app runs)
npm run backup -- --db data/dev.db          # back up the development database instead

docker compose stop                         # restore needs the app stopped
npm run restore -- backups/piggybank-20261007-153012.db
docker compose start
```

`restore` checks that the file really is a myPiggyBank backup and keeps a copy of the database it replaces (`backups/before-restore-*.db`). The 20 newest backups are kept.

To move to another laptop: copy the backup file over, run `./scripts/setup.sh` there, then `npm run restore -- <file>`.

## Currencies and exchange rates

- **Entering money:** a transaction uses its account's currency, so add an account per currency (e.g. Sparkasse in EUR, ICICI in INR). Assets and loans each have their own currency. Supported: EUR, INR, USD, GBP, CHF, AUD, CAD, SGD.
- **Show in:** the coin picker at the top of the sidebar (or the phone header) shows every page in one currency. _Default_ keeps each page's own currency: spending pages in the spending currency, wealth and accounts in the wealth currency (both set in Settings). Monthly figures use that month's rate; balances and net worth use the latest. Budget limits and snapshots are stored in their own currency, so they can only be changed in Default view.
- **Rates** (Settings → Exchange rates):
  - _Only my rates_ — one hand-entered rate per month; a month without one uses the latest earlier month.
  - _Live (daily ECB)_ — the server downloads the official European Central Bank reference rates from [Frankfurter](https://frankfurter.dev) once at start and every 6 hours (only the rate list is fetched; no data of yours is sent). Past months use their month-end rate. A rate you enter yourself still wins for its month. Offline, the last downloaded rates are kept. The source can be changed with `RATES_URL` in `.env`.
- Amounts that have no rate are never added 1:1: they are listed separately as "without a rate".

## Looks: modern and retro

Click the controller icon (top of the sidebar, the phone header, or the login page) to switch between the **modern** look (follows your system light/dark setting) and the **retro 8-bit** look (PICO-8 colours, pixel fonts, "PRESS START" screen). Click again to switch back; the choice is remembered on this device. The start screen is skipped for people who prefer reduced motion.

## Importing

- **Monthly spreadsheet** (Import → Monthly spreadsheet): one sheet per month (e.g. "Sep 26"), checked against each sheet's own totals.
- **Bank statement** (Import → Bank statement (CSV)): e.g. the Sparkasse CSV export. You map the columns, review every row (duplicates and unreadable rows are unticked), adjust categories — ticking "Remember" teaches the app for next time — then import.
- **Recurring** transactions (salary, rent, insurance…) are created automatically on their day.
- **Export**: Transactions → Export CSV (opens in Excel/LibreOffice).

## Project structure

```
backend/    Fastify API, Prisma schema & migrations, tests
frontend/   React app
scripts/    setup, backup, restore, Docker smoke test
e2e/        browser tests (Playwright)
docs/       design spec and implementation plans
data/       your SQLite databases (git-ignored)
```

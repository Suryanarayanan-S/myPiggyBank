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

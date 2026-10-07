# myPiggyBank

A simple, private family-finance app: income, expenses, budgets, accounts and net worth — running on your own machine.

> Status: Milestone 1 (foundation, login, family members). See `docs/superpowers/specs/` for the v1 design.

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

## Commands

| Command                               | What it does                                         |
| ------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                         | API on :3001 + web on :5173 with hot reload          |
| `npm run build && npm start`          | Production mode: one server on http://localhost:3001 |
| `npm test`                            | Backend + frontend tests                             |
| `npm run check`                       | Lint + typecheck + tests                             |
| `npm run format`                      | Prettier                                             |
| `npm run db:migrate`                  | Apply database migrations                            |
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

## Your data

Your real data (Docker) lives in `data/piggybank.db`; development uses `data/dev.db`. Neither is **ever committed to Git**. Moving data to another laptop is covered by the backup/restore scripts (coming in a later milestone).

## Project structure

```
backend/    Fastify API, Prisma schema & migrations, tests
frontend/   React app
scripts/    setup (and later backup/restore)
docs/       design spec and implementation plans
data/       your SQLite databases (git-ignored)
```

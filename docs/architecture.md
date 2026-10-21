# Architecture

myPiggyBank is one small web app: a React frontend talking JSON to a Fastify API, which keeps
everything in one SQLite file. A picture version for beginners is in
[how-it-works.html](how-it-works.html).

```
Browser ── React app (frontend/) ──fetch /api/*──▶ Fastify API (backend/) ──Prisma──▶ SQLite file (data/)
                                                        │
                                                        └─ optional: daily ECB rates (Frankfurter)
```

## Where things run

| Mode                         | Web                   | API          | Database            |
| ---------------------------- | --------------------- | ------------ | ------------------- |
| `npm run dev`                | Vite on :5173 (proxy) | :3001        | `data/dev.db`       |
| `npm run build && npm start` | served by the API     | :3001        | `data/dev.db`       |
| Docker (`docker compose`)    | served by the API     | :8080 → 3001 | `data/piggybank.db` |

Docker binds to `127.0.0.1`, so only this laptop can reach it. The container runs as a non-root
user, applies migrations on start, and has a health check (`/api/health`).

## Backend (`backend/src`)

- `app.ts` builds the server: security headers (CSP), cookies, rate limits, the CSRF check
  (unsafe methods must come from the same origin), session lookup, error mapping, routes, and
  static files for the built frontend.
- `routes/` — one file per area; each validates input with zod (`lib/validate.ts`) and calls a
  service.
- `services/` — the work: database reads and writes, always scoped to the caller's family.
  Another family's id behaves exactly like a missing one (404).
- `domain/` — pure functions with no database: the 50/30/20 month summary (`budget.ts`), the
  dashboard (`dashboard.ts`), net worth (`networth.ts`), currency conversion (`currency.ts`),
  recurring dates (`recurring.ts`), spreadsheet and bank-CSV parsing, category suggestions.
  Most rules live and are tested here.
- `server.ts` starts it all and runs two background jobs: recurring transactions (hourly) and live
  exchange rates (every 6 hours, only if a family chose live rates).

### Rules that hold everywhere

- **Money is integers**: minor units (cents, paise) with a currency code. Exchange rates are
  stored as micros (rate × 1,000,000). Rounding is half away from zero, once, at conversion.
- **Never 1:1**: an amount with no exchange rate is reported as "without a rate", not added.
- **Responses** are `{ data }` or `{ error: { code, message, details } }`.
- **Sessions**: a random token in an httpOnly, SameSite=Strict cookie; only its SHA-256 hash is
  stored. Passwords use argon2id.
- **Dates**: stored as UTC midnight of the calendar day; "today" follows `TZ` (Europe/Berlin in
  Docker).

## Frontend (`frontend/src`)

- `pages/` — one per screen; `components/` — pieces per area plus `ui/` basics.
- Server data comes through TanStack Query (`lib/api.ts`, `lib/queries.ts`); query keys include
  the month and the "Show in" currency, so switching refetches.
- `lib/` holds tested helpers: money formatting and parsing (Indian grouping for INR), months,
  chart scales, the light/dark choice and view-currency choice (both remembered per browser).
- Charts use Recharts with colour tokens from `index.css`, checked for colour-blind safety in
  light and dark.

## Tests

| Kind             | Where                                                           | Command                |
| ---------------- | --------------------------------------------------------------- | ---------------------- |
| Domain + API     | `backend/test/` (real SQLite test DB)                           | `npm test -w backend`  |
| Frontend helpers | `frontend/src/**/*.test.ts`                                     | `npm test -w frontend` |
| Browser          | `e2e/*.spec.ts` (Playwright, screenshots in `e2e/screenshots/`) | `npm run e2e`          |
| Docker           | `scripts/docker-smoke.sh` (fresh clone build, health, data dir) | `npm run docker:smoke` |

`npm run check` runs lint, typecheck and all unit/API tests.

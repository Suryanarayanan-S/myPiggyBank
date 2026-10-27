#!/usr/bin/env bash
# Starts the production build against a throw-away database for Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="$PWD/e2e/.tmp/e2e.db"
mkdir -p "$(dirname "$DB")"
rm -f "$DB" "$DB-wal" "$DB-shm"
export DATABASE_URL="file:$DB" NODE_ENV=production HOST=127.0.0.1 PORT=3101 \
  COOKIE_SECURE=false ALLOW_REGISTRATION=true SESSION_DAYS=30 \
  LOGIN_RATE_LIMIT=1000 \
  PRICES_URL=http://127.0.0.1:9/nse IBJA_URL=http://127.0.0.1:9/ibja \
  NSE_HISTORY_URL=http://127.0.0.1:9/nse-history \
  GOLD_PRICE_URL=http://127.0.0.1:9/gold GOLD_HISTORY_URL=http://127.0.0.1:9/gold-history ONVISTA_URL=http://127.0.0.1:9/onvista ECB_URL=http://127.0.0.1:9/ecb  # never the real sources: a closed port, downloads fail fast
# AI: the stand-in from e2e/ai-stub.mjs, never Claude
export ANTHROPIC_API_KEY=e2e-stub ANTHROPIC_BASE_URL=http://127.0.0.1:3102 AI_MODEL=claude-opus-5-5
# every test registers its own family (LOGIN_RATE_LIMIT)
(cd backend && npx prisma migrate deploy >/dev/null)
exec node backend/dist/server.js

#!/usr/bin/env bash
# Builds the image, starts it against a throw-away data dir, checks health,
# registers a user, restarts the container and verifies the user survived.
set -euo pipefail
cd "$(dirname "$0")/.."

# Like a fresh clone: the data dir does not exist yet, so Docker creates it (root-owned).
TMP_ROOT=$(mktemp -d)
export DATA_DIR="$TMP_ROOT/data"
export APP_PORT="${SMOKE_PORT:-18080}"  # SMOKE_PORT=… if 18080 is taken
PROJECT=pbsmoke
BASE="http://127.0.0.1:${APP_PORT}"
cleanup() {
  docker compose -p "$PROJECT" down -v >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT" 2>/dev/null || docker run --rm -v "$TMP_ROOT:/t" alpine rm -rf /t/data
}
trap cleanup EXIT

docker compose -p "$PROJECT" up -d --build --wait || { docker compose -p "$PROJECT" logs --tail 20; exit 1; }
curl -fsS "$BASE/api/health" | grep -q '"status":"ok"'
echo "✓ health"

curl -fsS "$BASE/settings" | grep -q '<div id="root">'
echo "✓ frontend served"

curl -fsS -H 'content-type: application/json' \
  -d '{"name":"Smoke","email":"smoke@example.com","password":"smoke-test-password"}' \
  "$BASE/api/auth/register" >/dev/null
echo "✓ register"

docker compose -p "$PROJECT" restart >/dev/null
docker compose -p "$PROJECT" up -d --wait >/dev/null
curl -fsS -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"smoke-test-password"}' \
  "$BASE/api/auth/login" | grep -q '"email":"smoke@example.com"'
echo "✓ data persisted across restart"

test -f "$DATA_DIR/piggybank.db"
echo "✓ database file on host: $DATA_DIR/piggybank.db"
echo "Docker smoke test passed."

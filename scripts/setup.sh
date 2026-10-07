#!/usr/bin/env bash
# First-time setup for myPiggyBank. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

REQUIRED_NODE=22
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js $REQUIRED_NODE+ is required. Install nvm (https://github.com/nvm-sh/nvm), then run: nvm install"
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if (( major < REQUIRED_NODE )); then
  echo "Node.js $REQUIRED_NODE+ required (found $(node -v)). Run: nvm install && nvm use"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi
mkdir -p data

npm install
npm run db:migrate

echo
echo "Setup complete."
echo "  Development:  npm run dev    → http://localhost:5173"
echo "  Production:   npm run build && npm start    → http://localhost:3001"

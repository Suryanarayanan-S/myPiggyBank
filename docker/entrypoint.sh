#!/bin/sh
set -e
cd /app/backend
npx prisma migrate deploy
exec node dist/server.js

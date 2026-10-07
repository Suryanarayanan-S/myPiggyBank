#!/bin/sh
# Starts as root only to make the bind-mounted data dir writable (Docker creates a
# missing ./data as root), then drops to the unprivileged "node" user for everything else.
set -e
if [ "$(id -u)" = "0" ]; then
  chown node:node /app/data
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi
cd /app/backend
npx prisma migrate deploy
exec node dist/server.js

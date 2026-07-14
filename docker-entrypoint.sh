#!/bin/sh
set -e

# Apply pending migrations before starting. Fails loudly (and blocks boot) if a
# migration cannot be applied. Databases created before the migration-based
# workflow must be baselined once:
#   ./node_modules/.bin/prisma migrate resolve --applied 0001_init
./node_modules/.bin/prisma migrate deploy

# exec replaces this shell so node runs as PID 1 and receives SIGTERM directly
# (a plain `sh -c "... && node"` keeps sh as PID 1, which does not forward
# signals — Docker would SIGKILL after the grace period on every update).
# The graceful drain itself lives in src/lib/shutdown.ts.
exec node server.js

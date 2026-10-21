#!/bin/sh
set -eu
if [ -n "${DATABASE_URL_FILE:-}" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then echo 'Set only DATABASE_URL or DATABASE_URL_FILE.' >&2; exit 1; fi
  DATABASE_URL=$(cat "$DATABASE_URL_FILE")
  export DATABASE_URL
  unset DATABASE_URL_FILE
fi
if [ -z "${PRISMA_SCHEMA_ENGINE_BINARY:-}" ]; then
  for f in /app/node_modules/@prisma/engines/schema-engine-*; do
    if [ -f "$f" ]; then export PRISMA_SCHEMA_ENGINE_BINARY="$f"; break; fi
  done
fi
# Start the API only after its bundled migrations have been applied. One-off
# tooling commands (migrations, bootstrap, backup checks) run without this step.
if [ "${1:-}" = node ] && [ "${2:-}" = dist/index.js ]; then
  echo 'Applying database migrations before starting the API...'
  node tools/prisma.cjs migrate deploy
fi
exec "$@"

#!/bin/sh
set -eu
if [ -n "${DATABASE_URL_FILE:-}" ]; then
  if [ -n "${DATABASE_URL:-}" ]; then echo 'Set only DATABASE_URL or DATABASE_URL_FILE.' >&2; exit 1; fi
  DATABASE_URL=$(cat "$DATABASE_URL_FILE")
  export DATABASE_URL
  unset DATABASE_URL_FILE
fi
exec "$@"

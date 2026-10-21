#!/bin/sh
# This script is for a fresh, disposable CI project, never an existing installation.
set -eu
[ "${CI:-}" = true ] || { echo 'Run only in disposable CI.' >&2; exit 1; }
case "${COMPOSE_PROJECT_NAME:-}" in dive-ci-*) ;; *) echo 'A unique dive-ci-* Compose project is required.' >&2; exit 1;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
export COMPOSE_FILE=compose.yaml:deploy/compose.smoke.yaml
compose() { docker compose --env-file .env.production "$@"; }
bootstrap() { docker compose --env-file .env.production -f compose.yaml -f deploy/compose.smoke.yaml -f deploy/compose.bootstrap.yaml "$@"; }
compose config --quiet
compose up -d --wait --wait-timeout 120 db
compose run --rm backend npm run migrate:deploy
bootstrap run --rm backend npm run bootstrap:admin
compose up -d --wait --wait-timeout 120
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 http://127.0.0.1/api/ready > /dev/null
bootstrap run --rm -e CI=true -e SMOKE_TEST=1 backend node tools/smoke-production.cjs
archive=$(sh scripts/backup.sh)
# Restore to a distinct database, not over the running fixture application.
compose exec -T db sh -eu -c '
  export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
  exec createdb --host=127.0.0.1 --username=postgres --owner=dive_center dive_center_restore_test
'
compose exec -T db sh -eu -c '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec pg_restore --host=127.0.0.1 --username=dive_center --dbname=dive_center_restore_test --no-owner --no-acl --exit-on-error --single-transaction
' < "$archive"
compose run --rm -e CI=true -e SMOKE_TEST=1 backend node tools/smoke-restore.cjs

#!/bin/sh
# Run after test-proxy-relay.sh; never against a live installation.
set -eu
[ "${CI:-}" = true ] || { echo 'Run only in disposable CI.' >&2; exit 1; }
case "${COMPOSE_PROJECT_NAME:-}" in dive-ci-*) ;; *) echo 'A disposable dive-ci-* project is required.' >&2; exit 1;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
export NPM_PROXY_IP=172.30.251.4
export PROXY_RELAY_SUBNET=172.30.251.0/29
export PROXY_RELAY_CADDY_IP=172.30.251.2
export PROXY_RELAY_BACKEND_IP=172.30.251.3
live() { docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml "$@"; }
testing() { docker compose --project-directory "$root" -p dive-centre-testing --env-file .env.production --env-file .env.testing -f deploy/compose.testing.yaml "$@"; }
image=$(live images -q backend)
probe() {
  docker run --rm --network "${COMPOSE_PROJECT_NAME}_proxy_relay" --ip "$NPM_PROXY_IP" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    -e "PROBE_MODE=$1" -e "LIVE_HTML_DIGEST=${digest:-}" -v "$root/scripts/probe-parallel-testing.cjs:/probe.cjs:ro" --entrypoint node "$image" /probe.cjs
}
digest=$(probe baseline)
backend_id=$(live ps -q backend)
db_id=$(live ps -q db)
live_bill_count=$(live exec -T db psql -U postgres -d dive_center -Atc 'SELECT count(*) FROM "Bill"')
node scripts/prepare-parallel-testing.cjs
sh scripts/parallel-testing.sh start
sh scripts/parallel-testing.sh users
admin_username=$(node -e 'const fs=require("node:fs");process.stdout.write(require("node:util").parseEnv(fs.readFileSync(".env.production","utf8")).ADMIN_EMAIL)')
sh scripts/parallel-testing.sh allow "$admin_username"
probe active
[ "$(testing exec -T testdb psql -U postgres -d dive_center_testing -Atc 'SELECT count(*) FROM "Bill"')" = 0 ]
[ "$(testing exec -T testdb psql -U postgres -d dive_center_testing -Atc 'SELECT count(*) FROM "User"')" = 0 ]
[ "$(live ps -q backend)" = "$backend_id" ]
[ "$(live ps -q db)" = "$db_id" ]
[ "$(live exec -T db psql -U postgres -d dive_center -Atc 'SELECT count(*) FROM "Bill"')" = "$live_bill_count" ]
testing stop testweb
probe unavailable
sh scripts/parallel-testing.sh stop
probe stopped
docker volume inspect dive-centre-testing_testing_data > /dev/null
# This explicitly named test-only volume belongs to the disposable CI fixture.
testing down --volumes
printf '%s\n' 'Parallel testing: separate empty DB, unchanged live containers/data, rollback and volume retention verified.'

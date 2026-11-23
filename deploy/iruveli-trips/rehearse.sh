#!/usr/bin/env bash
# Restore and test only in a fresh, network-isolated PostgreSQL container.
set -euo pipefail
umask 077
[[ $# = 1 && -f "$1" && -s "$1" ]]
backup=$(realpath -- "$1")
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../.." && pwd)
live=dive-centre-prod-db-1
[[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$live")" = dive-centre-prod ]]
image=$(docker inspect -f '{{.Image}}' "$live")
work=$(mktemp -d)
container=''
cleanup() {
  if [[ -n "$container" ]]; then docker rm -fv "$container" >/dev/null; fi
  rm -rf -- "$work"
}
trap cleanup EXIT

# No live volume, no published port, no production credentials.
container=$(docker run -d --pull never --network none --no-healthcheck \
  --tmpfs /var/lib/postgresql:rw,nosuid,nodev,size=4g \
  -e PGDATA=/var/lib/postgresql/trips-rehearsal \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=trips_rehearsal "$image")
[[ "$container" != "$(docker inspect -f '{{.Id}}' "$live")" ]]
for i in {1..45}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d trips_rehearsal >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d trips_rehearsal
docker exec -i "$container" pg_restore --exit-on-error --no-owner --no-acl \
  -h 127.0.0.1 -U postgres -d trips_rehearsal < "$backup"
sql() { docker exec -i "$container" psql -h 127.0.0.1 -X -qAt -v ON_ERROR_STOP=1 -U postgres -d trips_rehearsal "$@"; }
[[ "$(sql -c "SELECT to_regclass('public.dive_trips') IS NULL AND to_regclass('public.\"TankSession\"') IS NULL")" = t ]]

sql < "$here/fingerprint.sql" > "$work/before"
for migration in 20261114000000_tank_commission 20261114020000_trip_storage_names 20261114030000_trip_resource_relations; do
  sql < "$root/backend/prisma/migrations/$migration/migration.sql" >/dev/null
  printf 'PASS: %s\n' "$migration"
done
sql < "$here/fingerprint.sql" > "$work/after"
if ! cmp -s "$work/before" "$work/after"; then
  printf 'FAIL: the restored baseline table fingerprints changed.\n' >&2
  exit 1
fi
for table in TankCommissionSettings TankResource TankCommissionRule dive_trips trip_crew_assignments dive_trip_sites; do
  [[ "$(sql -c "SELECT count(*) FROM \"$table\"")" = 0 ]]
done
printf 'PASS: %s pre-existing tables match. All six trip tables are empty.\n' "$(wc -l < "$work/before" | tr -d ' ')"
printf 'Backup SHA-256: '
sha256sum < "$backup"

#!/usr/bin/env bash
# Rehearse the already-built release against a temporary database, never the live database.
set -euo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run with sudo bash.'; exit 1; }
root=/srv/dive-centre-prod
db=dive-centre-prod-db-1
backend=dive-centre-prod-backend-1
candidate=dive-centre-backend:8857c4a4
cd "$root"
exec 9>"$root/.manual-release.lock"
flock -n 9 || { echo 'Another manual release task is running.'; exit 1; }
available_kb=$(df -Pk "$root" | awk 'NR==2 {print $4}')
test "$available_kb" -ge 2097152 || { echo 'Less than 2 GiB free. Stop and report disk space.'; exit 1; }
test ! -f /var/lib/dive-cd/production/active.override.json
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$db")" = dive-centre-prod
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$backend")" = dive-centre-prod
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$db")" = dive-centre-prod_postgres_data_live_20261101
docker image inspect "$candidate" >/dev/null
backup=$(find "$root/backups" -maxdepth 1 -type d -name 'pre-8857c4a4-*' | sort | tail -n 1)
test -n "$backup"
test -s "$backup/production.dump"
(cd "$backup" && sha256sum -c SHA256SUMS)
network=$(python3 - <<'PY'
import json,subprocess
db,api=json.loads(subprocess.check_output(['docker','inspect','dive-centre-prod-db-1','dive-centre-prod-backend-1']))
common=set(db['NetworkSettings']['Networks']) & set(api['NetworkSettings']['Networks'])
if len(common)!=1: raise SystemExit('Expected exactly one shared database network. Stop and report this.')
print(next(iter(common)))
PY
)
clone="dive_rehearsal_8857c4a4_$(date -u +%Y%m%d%H%M%S)_$$"
[[ "$clone" =~ ^dive_rehearsal_8857c4a4_[0-9]+_[0-9]+$ ]]
work="$backup/$clone"
mkdir -m 700 "$work"
created=0
admin_sql() {
  docker exec -i "$db" sh -ec '
    export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
    exec psql -h 127.0.0.1 -U postgres -d postgres --no-psqlrc -v ON_ERROR_STOP=1
  '
}
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [ "$created" = 1 ]; then
    if ! printf 'DROP DATABASE IF EXISTS "%s" WITH (FORCE);\n' "$clone" | admin_sql; then
      echo "Temporary database cleanup failed: $clone" >&2
      result=1
    fi
  fi
  rm -f "$work/database_url"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$root/captured/secrets/database_url" "$work/database_url" "$clone" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import sys
source=urlsplit(Path(sys.argv[1]).read_text().strip())
if source.hostname!='db' or source.path!='/dive_center': raise SystemExit('Unexpected production datasource. Stop and report this.')
Path(sys.argv[2]).write_text(urlunsplit((source.scheme,source.netloc,'/'+sys.argv[3],source.query,source.fragment))+'\n')
Path(sys.argv[2]).chmod(0o444)
PY
# Mark before the call so cleanup also handles a disconnect after CREATE succeeds.
created=1
printf 'CREATE DATABASE "%s" OWNER dive_center;\n' "$clone" | admin_sql
docker exec -i "$db" sh -ec '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec pg_restore -h 127.0.0.1 -U dive_center -d "$1" --no-owner --no-acl --exit-on-error --single-transaction
' sh "$clone" < "$backup/production.dump"
run_image() {
  local image=$1
  shift
  docker run --rm -i --network "$network" --read-only --tmpfs /tmp:size=64m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 128 \
    -e NODE_ENV=production -e TESTING_LIVE_AUTH=false \
    -e DATABASE_URL_FILE=/run/secrets/database_url \
    -e JWT_SECRET_FILE=/run/secrets/jwt_secret \
    -e AUTHENTICATOR_ENCRYPTION_KEY_FILE=/run/secrets/authenticator_key \
    -e PMS_API_KEY_FILE=/run/secrets/pms_api_key \
    --mount "type=bind,src=$work/database_url,dst=/run/secrets/database_url,readonly" \
    --mount "type=bind,src=$root/captured/secrets/jwt_secret,dst=/run/secrets/jwt_secret,readonly" \
    --mount "type=bind,src=$root/captured/secrets/authenticator_key,dst=/run/secrets/authenticator_key,readonly" \
    --mount "type=bind,src=$root/captured/secrets/pms_api_key,dst=/run/secrets/pms_api_key,readonly" \
    "$image" "$@"
}
fingerprint() {
  run_image "$1" node - <<'JS'
const crypto=require('node:crypto');
const {prisma}=require('./dist/db');
(async()=>{
 const result={};
 for(const [table,key] of [['User','id'],['Authenticator','userId'],['UserProperty','id'],['PasswordReset','userId']]){
  const [row]=await prisma.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "${key}"), '[]'::jsonb) AS data FROM "${table}" t`);
  result[table]={count:row.data.length,sha256:crypto.createHash('sha256').update(JSON.stringify(row.data)).digest('hex')};
 }
 console.log(JSON.stringify(result,null,2));
})().catch(()=>{console.error('Account fingerprint failed.');process.exitCode=1}).finally(()=>prisma.$disconnect());
JS
}
old=$(docker inspect --format '{{.Image}}' "$backend")
fingerprint "$old" > "$work/accounts.before.json"
run_image "$candidate" node tools/prisma.cjs migrate deploy
fingerprint "$candidate" > "$work/accounts.after.json"
diff -u "$work/accounts.before.json" "$work/accounts.after.json"
run_image "$candidate" node - <<'JS'
const {prisma}=require('./dist/db');
const {decryptSecret}=require('./dist/services/authenticatorService');
(async()=>{
 const rows=await prisma.authenticator.findMany({select:{userId:true,secretCiphertext:true,pendingCiphertext:true}});
 for(const row of rows)for(const value of [row.secretCiphertext,row.pendingCiphertext])if(value)decryptSecret(row.userId,value);
 console.log('Authenticator encryption verified for',rows.length,'bindings.');
})().catch(()=>{console.error('Authenticator compatibility failed.');process.exitCode=1}).finally(()=>prisma.$disconnect());
JS
docker image inspect --format '{{.Id}}' "$candidate" > "$work/candidate-image-id.txt"
printf '%s\n' "$work" > "$backup/REHEARSAL_PASSED"
echo 'Migration rehearsal passed. Account records and authenticator encryption preserved.'
echo "Rehearsal records: $work"
echo 'Production services and database were not modified. Temporary database will now be removed.'

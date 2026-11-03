#!/usr/bin/env bash
# Manual production cutover for the already-built, rehearsed 8857c4a4 release.
# Never removes the live database or its volume. Failed migrations require reviewed recovery.
set -euo pipefail
umask 077
test "$(id -u)" = 0 || { echo 'Run as root.'; exit 1; }
root=/srv/dive-centre-prod
db=dive-centre-prod-db-1
backend=dive-centre-prod-backend-1
web=dive-centre-prod-web-1
candidate=dive-centre-backend:8857c4a4
candidate_web=dive-centre-web:8857c4a4
backup="$root/backups/pre-8857c4a4-20261103T094031Z"
cd "$root"
exec 9>"$root/.manual-release.lock"
flock -n 9 || { echo 'Another manual release task is running.'; exit 1; }
test ! -f /var/lib/dive-cd/production/active.override.json
test ! -f "$root/RELEASE_8857c4a4_STARTED" || { echo 'A previous cutover started. Inspect its journal before retrying.'; exit 1; }
test ! -f "$root/RELEASE_8857c4a4_COMPLETE" || { echo 'Release already completed. Do not run twice.'; exit 1; }
test "$(df -Pk "$root" | awk 'NR==2 {print $4}')" -ge 2097152
for container in "$db" "$backend" "$web"; do
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" = dive-centre-prod
  test "$(docker inspect --format '{{.State.Running}}' "$container")" = true
done
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$db")" = dive-centre-prod_postgres_data_live_20261101
(cd "$backup" && sha256sum -c SHA256SUMS)
test -s "$backup/REHEARSAL_PASSED"
rehearsal=$(cat "$backup/REHEARSAL_PASSED")
[[ "$rehearsal" == "$backup"/dive_rehearsal_8857c4a4_* ]]
candidate_id=$(docker image inspect --format '{{.Id}}' "$candidate")
test "$candidate_id" = "$(cat "$rehearsal/candidate-image-id.txt")"
web_id=$(docker image inspect --format '{{.Id}}' "$candidate_web")
old=$(docker inspect --format '{{.Image}}' "$backend")
old_web=$(docker inspect --format '{{.Image}}' "$web")
network=$(python3 - <<'NETWORK'
import json,subprocess
items=json.loads(subprocess.check_output(['docker','inspect','dive-centre-prod-db-1','dive-centre-prod-backend-1']))
common=set(items[0]['NetworkSettings']['Networks']) & set(items[1]['NetworkSettings']['Networks'])
if len(common)!=1: raise SystemExit('Expected exactly one shared database network.')
print(next(iter(common)))
NETWORK
)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work="$root/backups/cutover-8857c4a4-$stamp-$$"
mkdir -m 700 "$work"
cp -p compose.app.yaml "$work/compose.original.yaml"
docker image tag "$old" "dive-centre-backend:rollback-cutover-$stamp"
docker image tag "$old_web" "dive-centre-web:rollback-cutover-$stamp"
printf '%s\n%s\n' "$old" "$old_web" > "$work/previous-image-ids.txt"
printf '%s\n%s\n' "$candidate_id" "$web_id" > "$work/candidate-image-ids.txt"
compose() {
  docker compose --project-directory "$root" -p dive-centre-prod --env-file /dev/null \
    -f "$root/compose.migration.yaml" -f "$root/compose.app.yaml" "$@"
}
# Change only the two image references; fail before downtime if the file shape differs.
python3 - "$root" "$work" "$candidate_id" "$web_id" "$old" "$old_web" <<'CONFIG'
import json,re,subprocess,sys
from pathlib import Path
root,work,api,web,old_api,old_web=sys.argv[1:]
args=['docker','compose','--project-directory',root,'-p','dive-centre-prod','--env-file','/dev/null','-f',root+'/compose.migration.yaml','-f']
original=Path(root+'/compose.app.yaml').read_text()
lines=original.splitlines(keepends=True)
service=None
counts={'backend':0,'web':0}
for i,line in enumerate(lines):
    match=re.match(r'^  ([a-zA-Z0-9_-]+):\s*(?:#.*)?$',line.rstrip('\n'))
    if match: service=match[1]
    if service in counts and re.match(r'^    image:',line):
        counts[service]+=1
        lines[i]='    image: '+({'backend':api,'web':web}[service])+'\n'
if counts!={'backend':1,'web':1}: raise SystemExit('Unexpected compose image declarations; no live changes made.')
path=work+'/compose.candidate.yaml'
Path(path).write_text(''.join(lines))
before=json.loads(subprocess.check_output(args+[root+'/compose.app.yaml','config','--format','json']))
after=json.loads(subprocess.check_output(args+[path,'config','--format','json']))
for name,image,old in [('backend',api,old_api),('web',web,old_web)]:
    current=before['services'][name]['image']
    resolved=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',current],text=True).strip()
    if resolved!=old: raise SystemExit('Compose images do not match running services; no live changes made.')
    before['services'][name]['image']=image
if before!=after: raise SystemExit('Candidate configuration changed more than images; no live changes made.')
CONFIG
maintenance=0
migration_started=0
web_attempted=0
complete=0
finish() {
  result=$?
  trap - EXIT
  set +e
  if [ "$complete" != 1 ] && [ "$maintenance" = 1 ]; then
    if [ "$migration_started" = 0 ]; then
      echo 'Failure before migrations. Restarting the original application.' >&2
      compose up -d --no-deps --no-build --pull never backend web
    elif [ "$web_attempted" = 0 ]; then
      compose stop web backend
      echo 'Migration/startup did not complete. Application remains offline for reviewed recovery.' >&2
    else
      echo 'The website may have accepted writes. No automatic database restore was attempted.' >&2
    fi
    echo "Release records and final backup: $work" >&2
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
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
    --mount "type=bind,src=$root/captured/secrets/database_url,dst=/run/secrets/database_url,readonly" \
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

printf '%s\n' "$work" > "$root/RELEASE_8857c4a4_STARTED"
echo 'Preflight passed. Stopping only the production Dive Centre web and backend.'
maintenance=1
compose stop web backend
# Both known application writers must be stopped before the final dump.
for container in "$backend" "$web"; do
  test "$(docker inspect --format '{{.State.Running}}' "$container")" = false
done
tar -czf "$work/configuration.tar.gz" compose.migration.yaml compose.app.yaml captured
docker inspect "$db" "$backend" "$web" > "$work/containers.json"
docker exec "$db" sh -ec '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec pg_dump -h 127.0.0.1 -U dive_center -d dive_center -Fc --no-owner --no-acl
' > "$work/production.dump"
test -s "$work/production.dump"
docker exec -i "$db" pg_restore --list < "$work/production.dump" > "$work/restore-list.txt"
(cd "$work" && sha256sum production.dump configuration.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
fingerprint "$old" > "$work/accounts.before.json"
migration_started=1
run_image "$candidate_id" node tools/prisma.cjs migrate deploy
fingerprint "$candidate_id" > "$work/accounts.after.json"
diff -u "$work/accounts.before.json" "$work/accounts.after.json"
run_image "$candidate_id" node - <<'JS'
const {prisma}=require('./dist/db');
const {decryptSecret}=require('./dist/services/authenticatorService');
(async()=>{
 const rows=await prisma.authenticator.findMany({select:{userId:true,secretCiphertext:true,pendingCiphertext:true}});
 for(const row of rows)for(const value of [row.secretCiphertext,row.pendingCiphertext])if(value)decryptSecret(row.userId,value);
 console.log('Authenticator encryption verified for',rows.length,'bindings.');
})().catch(()=>{console.error('Authenticator compatibility failed.');process.exitCode=1}).finally(()=>prisma.$disconnect());
JS

# Preserve the existing file permissions and every setting except the image references.
cp -p "$root/compose.app.yaml" "$root/.compose.app.8857c4a4.tmp"
cat "$work/compose.candidate.yaml" > "$root/.compose.app.8857c4a4.tmp"
mv -f "$root/.compose.app.8857c4a4.tmp" "$root/compose.app.yaml"
compose up -d --no-deps --no-build --pull never --force-recreate backend
ready=0
for attempt in $(seq 1 90); do
  if docker exec "$backend" node -e 'fetch("http://127.0.0.1:5001/api/ready", {signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" = 1 || { echo 'Backend readiness failed.' >&2; exit 1; }
test "$(docker inspect --format '{{.Image}}' "$backend")" = "$candidate_id"
# From this point requests may write live data, so an automatic database rollback is unsafe.
web_attempted=1
compose up -d --no-deps --no-build --pull never --force-recreate web
ready=0
for attempt in $(seq 1 30); do
  # The web container deliberately rejects direct connections outside the trusted proxy.
  if curl --noproxy '*' --fail --silent --show-error --max-time 5 https://diving.ssrsys.com/api/ready > "$work/readiness.json" 2>/dev/null && \
     curl --noproxy '*' --fail --silent --show-error --max-time 5 https://diving.ssrsys.com/ > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" = 1 || { echo 'Web readiness failed. Inspect logs; do not restore an old database automatically.' >&2; exit 1; }
test "$(docker inspect --format '{{.Image}}' "$web")" = "$web_id"
printf '%s\n' "$work" > "$root/RELEASE_8857c4a4_COMPLETE"
complete=1
compose ps
echo 'Production release 8857c4a4 completed. Database volume, feature flags and secrets preserved.'
echo "Final backup and release records: $work"
echo 'Next verify the public website, sign-in, billing and manager commission rules.'

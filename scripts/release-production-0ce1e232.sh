#!/usr/bin/env bash
# Manual production-only release. Application source is pinned independently of this helper.
set -euo pipefail
umask 077
release=0ce1e232
commit=0ce1e2329192e0b31d2d8613de1794f69b0c3dea
root=/srv/dive-centre-prod
work="$root/releases/manual-$release"
db=dive-centre-prod-db-1
backend=dive-centre-prod-backend-1
web=dive-centre-prod-web-1
secrets="$root/captured/secrets"
fingerprint_tool=/usr/local/lib/dive-production-0ce1e232/fingerprint.cjs
phase=${1:-}
test "$(id -u)" = 0 || { echo 'Run this helper with sudo.'; exit 1; }
case "$phase" in prepare|deploy) ;; *) echo 'Usage: helper prepare /absolute/source/checkout OR helper deploy'; exit 1;; esac
test -z "${DOCKER_HOST:-}"
test "${DOCKER_CONTEXT:-default}" = default
cd "$root"
exec 9>"$root/.manual-release.lock"
flock -n 9 || { echo 'Another manual production release task is running.'; exit 1; }
test ! -f /var/lib/dive-cd/production/active.override.json || { echo 'Production CI/CD is enrolled. Use its deployment procedure.'; exit 1; }
test -s "$fingerprint_tool"
test "$(sha256sum "$fingerprint_tool" | cut -d' ' -f1)" = d7f9aa245d27addea950e13c77db900fcdc8e45fb234c7099c4ae156227edafa || { echo 'Fingerprint helper checksum mismatch.'; exit 1; }
python3 - <<'HOST'
import json,subprocess
interfaces=json.loads(subprocess.check_output(['ip','-j','-4','addr','show']))
if not any(a.get('local')=='192.168.135.39' for interface in interfaces for a in interface.get('addr_info',[])):
    raise SystemExit('This helper only runs on production at 192.168.135.39.')
HOST
for container in "$db" "$backend" "$web"; do
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" = dive-centre-prod
  test "$(docker inspect --format '{{.State.Running}}' "$container")" = true
done
for container in "$db" "$backend"; do
  test "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy
done
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$db")" = dive-centre-prod_postgres_data_live_20261101
python3 - "$root" <<'MOUNTS'
import json,subprocess,sys
root=sys.argv[1]
backend,db,web=json.loads(subprocess.check_output(['docker','inspect','dive-centre-prod-backend-1','dive-centre-prod-db-1','dive-centre-prod-web-1']))
for item,names in [(backend,['database_url','jwt_secret','authenticator_key','pms_api_key']), (db,['database_password','postgres_admin_password'])]:
    mounts={m['Destination']:m['Source'] for m in item['Mounts']}
    for name in names:
        if mounts.get('/run/secrets/'+name)!=root+'/captured/secrets/'+name:
            raise SystemExit('Unexpected production secret mount. Stop and inspect configuration.')
if any(m['Destination']=='/srv' or m['Destination'].startswith('/srv/') for m in web['Mounts']):
    raise SystemExit('A frontend content mount would override the release image.')
MOUNTS
network=$(python3 - <<'NETWORK'
import json,subprocess
items=json.loads(subprocess.check_output(['docker','inspect','dive-centre-prod-db-1','dive-centre-prod-backend-1']))
common=set(items[0]['NetworkSettings']['Networks']) & set(items[1]['NetworkSettings']['Networks'])
if len(common)!=1: raise SystemExit('Expected exactly one shared production database network.')
print(next(iter(common)))
NETWORK
)
feature=$(docker exec "$backend" node -e '
if(process.env.NODE_ENV!=="production" || process.env.TESTING_LIVE_AUTH==="true" || process.env.DISCLAIMER_TEST_GUESTS==="true" || process.env.APP_DEPLOYMENT_MODE==="testing")process.exit(1);
const flag=process.env.ENABLE_DIVE_CENTRE ?? process.env.ENABLE_WATER_SPORTS ?? "false";
if(!["true","false"].includes(flag))process.exit(1);process.stdout.write(flag);
')
python3 - "$secrets/database_url" <<'DATASOURCE'
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import sys
url=urlsplit(Path(sys.argv[1]).read_text().strip())
if url.scheme not in ['postgres','postgresql'] or url.hostname!='db' or url.username!='dive_center' or url.path!='/dive_center' or parse_qs(url.query).get('schema',['public'])!=['public']:
    raise SystemExit('Unexpected production datasource. No application changes made.')
DATASOURCE
compose() {
  docker compose --project-directory "$root" -p dive-centre-prod --env-file /dev/null \
    -f "$root/compose.migration.yaml" -f "$root/compose.app.yaml" "$@"
}
admin_sql() {
  docker exec -i "$db" sh -ec '
    export PGPASSWORD="$(cat /run/secrets/postgres_admin_password)"
    exec psql -h127.0.0.1 -U postgres -d postgres --no-psqlrc -v ON_ERROR_STOP=1
  '
}
backup() {
  local target=$1
  mkdir -m700 "$target"
  tar -czf "$target/configuration.tar.gz" compose.migration.yaml compose.app.yaml captured
  docker inspect "$db" "$backend" "$web" > "$target/containers.json"
  docker exec "$db" sh -ec '
    export PGPASSWORD="$(cat /run/secrets/database_password)"
    exec pg_dump -h127.0.0.1 -U dive_center -d dive_center -Fc --no-owner --no-acl
  ' > "$target/production.dump"
  test -s "$target/production.dump"
  docker exec -i "$db" pg_restore --list < "$target/production.dump" > "$target/restore-list.txt"
  tar -tzf "$target/configuration.tar.gz" > /dev/null
  (cd "$target" && sha256sum production.dump configuration.tar.gz > SHA256SUMS && sha256sum -c SHA256SUMS)
}
compare_data() {
  if cmp -s "$1" "$2"; then return 0; fi
  python3 - "$1" "$2" <<'DIFFERENCES'
import json,sys
before=json.load(open(sys.argv[1]))['tables'];after=json.load(open(sys.argv[2]))['tables']
for name in before:
    if before[name]!=after.get(name): print('Data verification mismatch:',name,'rows before:',before[name]['count'],'rows after:',after.get(name,{}).get('count','missing'))
DIFFERENCES
  echo 'Original business data did not match. Stop and review the release records.' >&2
  return 1
}
url_file="$secrets/database_url"
baseline_file=
run_image() {
  local image=$1
  shift
  local -a extra=()
  if [ -n "$baseline_file" ]; then extra+=(--mount "type=bind,src=$baseline_file,dst=/run/release/baseline.json,readonly"); fi
  docker run --rm -i --network "$network" --read-only --tmpfs /tmp:size=64m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 128 \
    -e NODE_ENV=production -e TESTING_LIVE_AUTH=false -e APP_DEPLOYMENT_MODE=live -e DISCLAIMER_TEST_GUESTS=false \
    -e DATABASE_URL_FILE=/run/secrets/database_url -e JWT_SECRET_FILE=/run/secrets/jwt_secret \
    -e AUTHENTICATOR_ENCRYPTION_KEY_FILE=/run/secrets/authenticator_key -e PMS_API_KEY_FILE=/run/secrets/pms_api_key \
    --mount "type=bind,src=$url_file,dst=/run/secrets/database_url,readonly" \
    --mount "type=bind,src=$secrets/jwt_secret,dst=/run/secrets/jwt_secret,readonly" \
    --mount "type=bind,src=$secrets/authenticator_key,dst=/run/secrets/authenticator_key,readonly" \
    --mount "type=bind,src=$secrets/pms_api_key,dst=/run/secrets/pms_api_key,readonly" \
    --mount "type=bind,src=$fingerprint_tool,dst=/run/release/fingerprint.cjs,readonly" \
    "${extra[@]}" "$image" "$@"
}
verify_authenticators() {
  run_image "$candidate_id" node - <<'JS'
const {prisma}=require('./dist/db');
const {decryptSecret}=require('./dist/services/authenticatorService');
(async()=>{
 const rows=await prisma.authenticator.findMany({select:{userId:true,secretCiphertext:true,pendingCiphertext:true}});
 for(const row of rows)for(const value of [row.secretCiphertext,row.pendingCiphertext])if(value)decryptSecret(row.userId,value);
 console.log('Authenticator encryption verified for',rows.length,'bindings.');
})().catch(()=>{console.error('Authenticator compatibility failed.');process.exitCode=1}).finally(()=>prisma.$disconnect());
JS
}
created=0
maintenance=0
migration_started=0
web_attempted=0
complete=0
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [ "$created" = 1 ]; then
    if ! printf 'DROP DATABASE IF EXISTS "%s" WITH (FORCE);\n' "$clone" | admin_sql; then
      echo "Temporary database cleanup needs attention: $clone" >&2
      result=1
    fi
    rm -f "$work/rehearsal-database-url"
  fi
  if [ "$complete" != 1 ] && [ "$maintenance" = 1 ]; then
    if [ "$migration_started" = 0 ]; then
      echo 'Stopped before migrations. Restarting original application images.' >&2
      compose up -d --no-deps --no-build --pull never backend web
    elif [ "$web_attempted" = 0 ]; then
      compose stop web backend
      echo 'Production verification/startup failed. Applications remain offline for reviewed recovery.' >&2
    else
      echo 'The site may have accepted writes. No automatic database restore was attempted.' >&2
    fi
    echo "Final backup and release records: $work/cutover" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$phase" = prepare ]; then
  source_dir=$(realpath "${2:?Provide the pinned application source checkout.}")
  test "$(git -c safe.directory="$source_dir" -C "$source_dir" rev-parse HEAD)" = "$commit"
  test -z "$(git -c safe.directory="$source_dir" -C "$source_dir" status --porcelain --untracked-files=normal -- backend frontend)"
  test ! -e "$work" || { echo 'This preparation directory already exists. Inspect its prior journal before retrying.'; exit 1; }
  test "$(df -Pk "$root" | awk 'NR==2 {print $4}')" -ge 8388608 || { df -h /; echo 'Preparation requires at least 8 GiB free. Stop and report disk usage.'; exit 1; }
  mkdir -p -m700 "$root/releases"
  mkdir -m700 "$work"
  printf '%s\n' "$feature" > "$work/feature-flag"
  docker inspect --format '{{.Image}}' "$backend" > "$work/running-backend.id"
  docker inspect --format '{{.Image}}' "$web" > "$work/running-web.id"
  sha256sum compose.migration.yaml compose.app.yaml > "$work/compose.sha256"
  sha256sum "$secrets/database_url" "$secrets/database_password" "$secrets/postgres_admin_password" "$secrets/jwt_secret" "$secrets/authenticator_key" "$secrets/pms_api_key" > "$work/secrets.sha256"
  docker image tag "$(cat "$work/running-backend.id")" "dive-centre-backend:rollback-pre-$release"
  docker image tag "$(cat "$work/running-web.id")" "dive-centre-web:rollback-pre-$release"
  echo 'Building production images. Existing production services remain online.'
  docker build --pull=false --tag "dive-centre-backend:$release" "$source_dir/backend"
  docker build --pull=false --build-arg VITE_DEPLOYMENT_MODE=live --build-arg "VITE_ENABLE_WATER_SPORTS=$feature" \
    --tag "dive-centre-web:$release" "$source_dir/frontend"
  docker image inspect --format '{{.Id}}' "dive-centre-backend:$release" > "$work/candidate-backend.id"
  docker image inspect --format '{{.Id}}' "dive-centre-web:$release" > "$work/candidate-web.id"
  candidate_id=$(cat "$work/candidate-backend.id")
  web_id=$(cat "$work/candidate-web.id")
  docker run --rm --network none --entrypoint cat "$web_id" /srv/index.html | sha256sum | cut -d' ' -f1 > "$work/frontend.sha256"
  # Validate an image-only configuration change plus explicit production safety flags.
  python3 - "$root" "$work" "$candidate_id" "$web_id" <<'CONFIG'
import json,re,subprocess,sys
from pathlib import Path
root,work,api,web=sys.argv[1:]
lines=Path(root+'/compose.app.yaml').read_text().splitlines()
in_services=False; service=None; counts={'backend':0,'web':0}
for i,line in enumerate(lines):
    top=re.match(r'^([A-Za-z0-9_-]+):',line)
    if top: in_services=top.group(1)=='services'; service=None
    match=re.match(r'^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$',line)
    if in_services and match: service=match.group(1)
    if in_services and service in counts and re.match(r'^    image:',line):
        lines[i]='    image: '+({'backend':api,'web':web}[service]);counts[service]+=1
if counts!={'backend':1,'web':1}: raise SystemExit('Unexpected application image declarations. No services stopped.')
start=lines.index('  backend:')
end=next((i for i in range(start+1,len(lines)) if re.match(r'^  [A-Za-z0-9_-]+:',lines[i]) or re.match(r'^[A-Za-z0-9_-]+:',lines[i])),len(lines))
block=lines[start:end]
if '    environment:' not in block: raise SystemExit('Expected backend environment mapping.')
flags={'APP_DEPLOYMENT_MODE':'live','DISCLAIMER_TEST_GUESTS':'false','TESTING_LIVE_AUTH':'false'}
for key,value in flags.items():
    found=[i for i,line in enumerate(block) if re.match(r'^      '+key+r':',line)]
    if len(found)>1: raise SystemExit('Duplicate production environment setting.')
    if found: block[found[0]]=f'      {key}: "{value}"'
    else: block.insert(block.index('    environment:')+1,f'      {key}: "{value}"')
lines[start:end]=block
path=work+'/compose.candidate.yaml';Path(path).write_text('\n'.join(lines)+'\n')
args=['docker','compose','--project-directory',root,'-p','dive-centre-prod','--env-file','/dev/null','-f',root+'/compose.migration.yaml','-f']
before=json.loads(subprocess.check_output(args+[root+'/compose.app.yaml','config','--format','json']))
after=json.loads(subprocess.check_output(args+[path,'config','--format','json']))
for name,image in [('backend',api),('web',web)]:
    current=before['services'][name]['image']
    resolved=subprocess.check_output(['docker','image','inspect','--format','{{.Id}}',current],text=True).strip()
    if resolved!=Path(work+'/running-'+name+'.id').read_text().strip(): raise SystemExit('Configured images differ from running services.')
    before['services'][name]['image']=image
before['services']['backend'].setdefault('environment',{}).update(flags)
if before!=after: raise SystemExit('Candidate changed settings beyond the approved images and production safety flags.')
CONFIG
  echo 'Taking the rehearsal backup from the live database.'
  backup "$work/preparation"
  clone="dive_rehearsal_${release}_$(date -u +%Y%m%d%H%M%S)_$$"
  [[ "$clone" =~ ^dive_rehearsal_0ce1e232_[0-9]+_[0-9]+$ ]]
  python3 - "$secrets/database_url" "$work/rehearsal-database-url" "$clone" <<'CLONE_URL'
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import sys
source=urlsplit(Path(sys.argv[1]).read_text().strip())
Path(sys.argv[2]).write_text(urlunsplit((source.scheme,source.netloc,'/'+sys.argv[3],source.query,source.fragment))+'\n')
Path(sys.argv[2]).chmod(0o444)
CLONE_URL
  created=1
  printf 'CREATE DATABASE "%s" OWNER dive_center;\n' "$clone" | admin_sql
  docker exec -i "$db" sh -ec '
    export PGPASSWORD="$(cat /run/secrets/database_password)"
    exec pg_restore -h127.0.0.1 -U dive_center -d "$1" --no-owner --no-acl --exit-on-error --single-transaction
  ' sh "$clone" < "$work/preparation/production.dump"
  url_file="$work/rehearsal-database-url"
  run_image "$(cat "$work/running-backend.id")" node /run/release/fingerprint.cjs > "$work/rehearsal-before.json"
  chmod 444 "$work/rehearsal-before.json"
  run_image "$candidate_id" node tools/prisma.cjs migrate deploy
  baseline_file="$work/rehearsal-before.json"
  run_image "$candidate_id" node /run/release/fingerprint.cjs /run/release/baseline.json > "$work/rehearsal-after.json"
  compare_data "$work/rehearsal-before.json" "$work/rehearsal-after.json"
  verify_authenticators
  printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$clone" | admin_sql
  created=0
  rm -f "$work/rehearsal-database-url"
  sha256sum -c "$work/compose.sha256"
  sha256sum -c "$work/secrets.sha256"
  printf '%s\n' "$commit" > "$work/READY"
  complete=1
  echo 'PRODUCTION PREPARATION PASSED. All original table values and historical credits verified on the migrated clone.'
  echo 'Live application services and live database schema were not changed. Next run the deploy phase.'
  exit 0
fi

test -f "$work/READY"
test "$(cat "$work/READY")" = "$commit"
test ! -e "$work/STARTED" || { echo 'A cutover already started. Inspect its journal before retrying.'; exit 1; }
test ! -e "$work/COMPLETE"
test "$(df -Pk "$root" | awk 'NR==2 {print $4}')" -ge 2097152
sha256sum -c "$work/compose.sha256"
sha256sum -c "$work/secrets.sha256"
test "$feature" = "$(cat "$work/feature-flag")"
test "$(docker inspect --format '{{.Image}}' "$backend")" = "$(cat "$work/running-backend.id")"
test "$(docker inspect --format '{{.Image}}' "$web")" = "$(cat "$work/running-web.id")"
candidate_id=$(cat "$work/candidate-backend.id")
web_id=$(cat "$work/candidate-web.id")
test "$(docker image inspect --format '{{.Id}}' "dive-centre-backend:$release")" = "$candidate_id"
test "$(docker image inspect --format '{{.Id}}' "dive-centre-web:$release")" = "$web_id"
cp -p compose.app.yaml "$work/compose.original.yaml"
printf '%s\n' "$(date -u +%FT%TZ)" > "$work/STARTED"
maintenance=1
echo 'Beginning production maintenance. Stopping only Dive Centre web and backend.'
compose stop web backend
for container in "$backend" "$web"; do test "$(docker inspect --format '{{.State.Running}}' "$container")" = false; done
backup "$work/cutover"
run_image "$(cat "$work/running-backend.id")" node /run/release/fingerprint.cjs > "$work/cutover/before.json"
chmod 444 "$work/cutover/before.json"
migration_started=1
run_image "$candidate_id" node tools/prisma.cjs migrate deploy
baseline_file="$work/cutover/before.json"
run_image "$candidate_id" node /run/release/fingerprint.cjs /run/release/baseline.json > "$work/cutover/after.json"
compare_data "$work/cutover/before.json" "$work/cutover/after.json"
verify_authenticators
echo 'All original production table values and historical instructor/Photo recipients verified.'
cp -p compose.app.yaml "$root/.compose.app.$release.tmp"
cat "$work/compose.candidate.yaml" > "$root/.compose.app.$release.tmp"
mv -f "$root/.compose.app.$release.tmp" "$root/compose.app.yaml"
compose up -d --no-deps --no-build --pull never --force-recreate backend
ready=0
for attempt in $(seq 1 90); do
  if docker exec "$backend" node -e 'fetch("http://127.0.0.1:5001/api/ready",{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1 || { echo 'Backend readiness failed.' >&2; exit 1; }
test "$(docker inspect --format '{{.Image}}' "$backend")" = "$candidate_id"
docker exec "$backend" node -e 'if(process.env.APP_DEPLOYMENT_MODE!=="live"||process.env.DISCLAIMER_TEST_GUESTS!=="false"||process.env.TESTING_LIVE_AUTH!=="false")process.exit(1)'
web_attempted=1
compose up -d --no-deps --no-build --pull never --force-recreate web
ready=0
for attempt in $(seq 1 30); do
  if curl --noproxy '*' --compressed --fail --silent --show-error --max-time 10 https://diving.ssrsys.com/api/ready > "$work/cutover/readiness.json" 2>/dev/null && \
     python3 -c 'import json,sys; assert json.load(open(sys.argv[1])).get("status")=="ready"' "$work/cutover/readiness.json" 2>/dev/null && \
     curl --noproxy '*' --compressed --fail --silent --show-error --max-time 10 https://diving.ssrsys.com/ > "$work/cutover/public-index.html" 2>/dev/null && \
     test "$(sha256sum "$work/cutover/public-index.html" | cut -d' ' -f1)" = "$(cat "$work/frontend.sha256")"; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1 || { echo 'Public readiness or frontend version verification failed. Preserve live writes and inspect logs.' >&2; exit 1; }
test "$(docker inspect --format '{{.Image}}' "$web")" = "$web_id"
printf '%s\n' "$commit" > "$work/COMPLETE"
complete=1
if ! compose ps; then echo 'Release verified; container listing could not be printed.'; fi
echo 'PRODUCTION RELEASE 0ce1e232 COMPLETE.'
echo "Final backup and before/after data verification: $work/cutover"
echo 'Verify normal sign-in, manager bill/staff editors and instructor/Photo selection in the live browser.'

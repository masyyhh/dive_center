#!/usr/bin/env bash
# Update only the standalone testing project on the old server.
(
set -eu
umask 077
# The deployment account owns this testing directory and has Docker access.

root=/srv/dive-centre-testing-independent
project=dive-centre-testing-standalone
archive="${1:-}"
disclaimer_test_guests="${DISCLAIMER_TEST_GUESTS:-false}"
case "$disclaimer_test_guests" in true|false) ;; *) echo "DISCLAIMER_TEST_GUESTS must be true or false."; exit 1;; esac
if [ ! -f "$archive" ] || [ ! -f "$archive.sha256" ]; then
  printf 'Usage: bash deploy-testing-update-20261102.sh /path/to/release.tar.gz\n'
  exit 1
fi
archive=$(realpath "$archive")
cd "$root"
compose() { docker compose -p "$project" --env-file .env.testing -f compose.yaml "$@"; }

assert_database_scope() {
  db_id=$(compose ps -q db)
  test -n "$db_id" || return 1
  test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$db_id")" = "$project" || return 1
  test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' "$db_id")" = "${project}_testing_data" || return 1
}
assert_database_scope
backend_id=$(compose ps -q backend)
web_id=$(compose ps -q web)
test -n "$backend_id" && test -n "$web_id"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$backend_id")" = "$project"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$web_id")" = "$project"
python3 - <<'PY'
import subprocess, json, re
addresses=json.loads(subprocess.check_output(['ip','-j','-4','addr','show']))
if not any(a.get('local')=='192.168.130.3' for interface in addresses for a in interface.get('addr_info', [])):
    raise SystemExit('This updater must run on the old/testing server at 192.168.130.3.')
text=open('.env.testing').read()
if not re.search(r'^TESTING_HOSTNAME=diving-staging\.ssrsys\.com\s*$',text,re.M):
    raise SystemExit('Unexpected testing hostname. Stop and report this.')
PY

test "$(docker exec "$backend_id" node -e 'process.stdout.write(process.env.TESTING_LIVE_AUTH || "")')" = false
test ! -s secrets/pms_api_key
water_sports=$(docker exec "$backend_id" node -e 'process.stdout.write(process.env.ENABLE_WATER_SPORTS === "true" ? "true" : "false")')
if [ "$disclaimer_test_guests" = true ]; then water_sports=true; fi
available_bytes=$(df -B1 --output=avail /var/lib/docker | tail -n 1 | tr -d ' ')
if [ "$available_bytes" -lt 8589934592 ]; then
  printf 'Less than 8 GiB free for image builds and backups. Stop and report disk usage.\n'
  df -h /
  exit 1
fi

release_id=$(python3 - "$archive" <<'PY'
import hashlib, json, re, sys, tarfile
from pathlib import Path
archive=Path(sys.argv[1])
parts=Path(str(archive)+'.sha256').read_text().split()
if len(parts)!=2 or parts[1]!=archive.name or not re.fullmatch('[a-f0-9]{64}',parts[0]):
    raise SystemExit('Invalid release checksum file.')
if hashlib.sha256(archive.read_bytes()).hexdigest()!=parts[0]:
    raise SystemExit('Release archive checksum mismatch.')
with tarfile.open(archive,'r:gz') as tar:
    members=tar.getmembers()
    if len(members)>5000 or sum(m.size for m in members)>200*1024*1024:
        raise SystemExit('Release archive exceeds expected bounds.')
    manifest=json.load(tar.extractfile('release-manifest.json'))
    if manifest.get('environment')!='independent-testing' or not re.fullmatch(r'\d{8}-[a-f0-9]{12}',manifest.get('releaseId','')):
        raise SystemExit('Invalid testing release manifest.')
    expected={'release-manifest.json','release-notes.txt'} | {'source/'+name for name in manifest['files']}
    if len({m.name for m in members})!=len(members) or {m.name for m in members}!=expected:
        raise SystemExit('Unexpected archive entries.')
    for m in members:
        p=Path(m.name)
        if not m.isfile() or p.is_absolute() or '..' in p.parts or any(part.startswith('.env') or part in {'secrets','node_modules','.git','backups','dist'} for part in p.parts):
            raise SystemExit('Unsafe archive member.')
        if m.name.startswith('source/'):
            name=m.name[len('source/'):]
            if name.split('/')[0] not in {'backend','frontend'}:
                raise SystemExit('Unexpected source path.')
            if hashlib.sha256(tar.extractfile(m).read()).hexdigest()!=manifest['files'][name]['sha256']:
                raise SystemExit('Source file checksum mismatch: '+name)
    print(manifest['releaseId'])
PY
)

release_dir="$root/releases/$release_id"
if [ -e "$release_dir" ]; then
  printf 'This release directory already exists. Do not rerun; report the previous result.\n'
  exit 1
fi
mkdir -p -m 700 "$root/releases"
mkdir -m 700 "$release_dir"
python3 - "$archive" "$release_dir" <<'PY'
import shutil, sys, tarfile
from pathlib import Path
with tarfile.open(sys.argv[1],'r:gz') as tar:
    for member in tar.getmembers():
        target=Path(sys.argv[2])/member.name
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with target.open('xb') as output:
            shutil.copyfileobj(tar.extractfile(member),output)
        target.chmod(member.mode & 0o777)
PY
cp -p compose.yaml "$release_dir/compose.before.yaml"
old_backend_image=$(docker inspect --format '{{.Image}}' "$backend_id")
old_web_image=$(docker inspect --format '{{.Image}}' "$web_id")
docker image tag "$old_backend_image" "dive-testing-backend:rollback-$release_id"
docker image tag "$old_web_image" "dive-testing-web:rollback-$release_id"
printf '%s\n%s\n' "$old_backend_image" "$old_web_image" > "$release_dir/previous-image-ids.txt"

clone_database="dive_testing_rehearsal_${release_id//-/_}"
clone_created=0
frozen=0
migration_started=0
final_backup=
new_backend="dive-testing-backend:$release_id"
new_web="dive-testing-web:$release_id"

admin_sql() {
  assert_database_scope || return 1
  compose exec -T db sh -eu -c '
    export PGPASSWORD="$(cat /run/secrets/testing_postgres_password)"
    exec psql --host=127.0.0.1 --username=postgres --dbname=postgres --no-psqlrc --set ON_ERROR_STOP=1 --set "candidate=$1"
  ' sh "$clone_database"
}
cleanup_clone() {
  if [ "$clone_created" -eq 1 ]; then
    case "$clone_database" in dive_testing_rehearsal_[0-9]*_[a-f0-9]*) ;; *) return 1;; esac
    admin_sql <<'SQL' || return 1
SELECT format('DROP DATABASE IF EXISTS %I WITH (FORCE)', :'candidate') \gexec
SQL
    clone_created=0
  fi
  rm -f "$release_dir/rehearsal_database_url"
}
restore_dump() {
  dump_file="$1"
  database_name="$2"
  assert_database_scope || return 1
  compose exec -T db sh -eu -c '
    export PGPASSWORD="$(cat /run/secrets/testing_database_password)"
    exec pg_restore --host=127.0.0.1 --username=dive_center_testing --dbname="$1" --no-owner --no-acl --exit-on-error --single-transaction
  ' sh "$database_name" < "$dump_file"
}
rollback() {
  printf '\nUpdate failed. Restoring the previous TESTING installation.\n' >&2
  compose stop web backend || return 1
  if [ "$migration_started" -eq 1 ]; then
    test -n "$final_backup" && test -s "$final_backup/testing.dump" || return 1
    (cd "$final_backup" && sha256sum -c SHA256SUMS) || return 1
    assert_database_scope || return 1
    admin_sql <<'SQL' || return 1
DROP DATABASE dive_center_testing WITH (FORCE);
CREATE DATABASE dive_center_testing OWNER dive_center_testing;
REVOKE CONNECT ON DATABASE dive_center_testing FROM PUBLIC;
GRANT CONNECT ON DATABASE dive_center_testing TO dive_center_testing;
SQL
    restore_dump "$final_backup/testing.dump" dive_center_testing || return 1
  fi
  cp -p "$release_dir/compose.before.yaml" "$root/compose.yaml" || return 1
  compose config --quiet || return 1
  compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 backend || return 1
  compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 web || return 1
  printf 'Previous testing version and data restored.\n' >&2
}
on_exit() {
  result=$?
  trap - EXIT INT TERM HUP
  set +e
  if [ "$result" -ne 0 ] && [ "$frozen" -eq 1 ]; then
    if ! rollback; then
      printf 'AUTOMATIC TESTING ROLLBACK FAILED. Keep testing offline and report this output.\n' >&2
    fi
  fi
  if ! cleanup_clone; then
    printf 'Temporary testing clone cleanup needs attention: %s\n' "$clone_database" >&2
  fi
  exit "$result"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

make_backup() {
  log_file="$1"
  ./backup-testing.sh > "$log_file"
  backup_path=$(sed -n 's/^Testing backup saved privately to //p' "$log_file")
  case "$backup_path" in "$root"/backups/testing-*) ;; *) return 1;; esac
  test -s "$backup_path/testing.dump"
  (cd "$backup_path" && sha256sum -c SHA256SUMS > /dev/null)
}
run_image() {
  image="$1"
  url_file="$2"
  shift 2
  docker run --rm -i --network "${project}_database" \
    --read-only --tmpfs /tmp:size=64m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true --memory 512m --pids-limit 128 \
    --env NODE_ENV=production --env TESTING_LIVE_AUTH=false \
    --env DATABASE_URL_FILE=/run/secrets/database_url \
    --env JWT_SECRET_FILE=/run/secrets/jwt_secret \
    --env AUTHENTICATOR_ENCRYPTION_KEY_FILE=/run/secrets/authenticator_key \
    --env PMS_API_KEY_FILE=/run/secrets/pms_api_key \
    --mount "type=bind,src=$url_file,dst=/run/secrets/database_url,readonly" \
    --mount "type=bind,src=$root/secrets/jwt_secret,dst=/run/secrets/jwt_secret,readonly" \
    --mount "type=bind,src=$root/secrets/authenticator_key,dst=/run/secrets/authenticator_key,readonly" \
    --mount "type=bind,src=$root/secrets/pms_api_key,dst=/run/secrets/pms_api_key,readonly" \
    "$image" "$@"
}
fingerprint() {
  run_image "$1" "$2" node - <<'JS'
const crypto = require('node:crypto');
const { prisma } = require('./dist/db');
(async () => {
  const output = {};
  for (const [table,key] of [['User','id'],['Authenticator','userId'],['UserProperty','id'],['PasswordReset','userId']]) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "${key}"), '[]'::jsonb) AS data FROM "${table}" t`);
    output[table] = { count: row.data.length, sha256: crypto.createHash('sha256').update(JSON.stringify(row.data)).digest('hex') };
  }
  console.log(JSON.stringify(output,null,2));
})().catch(() => { console.error('Account fingerprint failed.'); process.exitCode=1; }).finally(() => prisma.$disconnect());
JS
}
verify_crypto() {
  run_image "$1" "$2" node - <<'JS'
const { prisma } = require('./dist/db');
const { decryptSecret, totp } = require('./dist/services/authenticatorService');
(async () => {
  if (totp('JBSWY3DPEHPK3PXP','verification').issuer !== 'Dive Centre Manager Testing') throw Error('Unexpected issuer');
  const bindings = await prisma.authenticator.findMany({ select: {userId:true, secretCiphertext:true, pendingCiphertext:true} });
  for (const binding of bindings) for (const value of [binding.secretCiphertext,binding.pendingCiphertext]) if (value) decryptSecret(binding.userId,value);
  console.log('Testing authenticator encryption verified for',bindings.length,'bindings.');
})().catch(() => { console.error('Testing authenticator compatibility check failed.'); process.exitCode=1; }).finally(() => prisma.$disconnect());
JS
}

printf '\nBuilding latest testing application images. Existing testing site stays online during builds.\n'
docker build --pull=false --tag "dive-testing-backend-core:$release_id" "$release_dir/source/backend"
docker build --pull=false --build-arg VITE_DEPLOYMENT_MODE=live \
  --build-arg "VITE_ENABLE_WATER_SPORTS=$water_sports" \
  --tag "dive-testing-web-core:$release_id" "$release_dir/source/frontend"
mkdir -m 700 "$release_dir/backend-branding" "$release_dir/web-branding"
cat > "$release_dir/backend-branding/Dockerfile" <<DOCKER
FROM dive-testing-backend-core:$release_id
USER root
RUN node -e 'const fs=require("node:fs");const p="/app/dist/services/authenticatorService.js";const s=fs.readFileSync(p,"utf8");if(!s.includes("Dive Centre Manager"))throw Error("Unknown issuer");fs.writeFileSync(p,s.split("Dive Centre Manager").join("Dive Centre Manager Testing"));'
USER node
LABEL org.opencontainers.image.title="Dive Centre Manager Independent Testing API"
DOCKER
cat > "$release_dir/web-branding/Dockerfile" <<DOCKER
FROM dive-testing-web-core:$release_id
USER root
RUN sed -i 's/"production"/"testing"/g' /srv/environment.js
RUN sed -i 's|<title>[^<]*</title>|<title>TESTING Dive Centre Manager</title>|g; s|</body>|<div id="testing-environment-label" role="status" style="position:fixed;bottom:12px;right:12px;z-index:99999;padding:8px 12px;background:#fff2cc;color:#222;border:1px solid #c89b32;border-radius:6px;font:600 12px sans-serif;pointer-events:none">TESTING ONLY - Separate database</div></body>|g' /srv/index.html && grep -q testing-environment-label /srv/index.html
LABEL org.opencontainers.image.title="Dive Centre Manager Independent Testing"
DOCKER
base_web_user=$(docker image inspect --format '{{.Config.User}}' "dive-testing-web-core:$release_id")
if [ -n "$base_web_user" ]; then printf '\nUSER %s\n' "$base_web_user" >> "$release_dir/web-branding/Dockerfile"; fi
docker build --pull=false --network=none --tag "$new_backend" "$release_dir/backend-branding"
docker build --pull=false --network=none --tag "$new_web" "$release_dir/web-branding"
docker run --rm --network none --read-only --tmpfs /tmp:size=64m,mode=1777 \
  --mount "type=bind,src=$root/Caddyfile.testing,dst=/etc/caddy/Caddyfile,readonly" \
  --entrypoint caddy "$new_web" validate --config /etc/caddy/Caddyfile --adapter caddyfile

python3 - "$release_dir" "$release_id" "$disclaimer_test_guests" <<'PY'
from pathlib import Path
import re, sys
release=Path(sys.argv[1]); rid=sys.argv[2]; test_guests=sys.argv[3]
lines=Path('compose.yaml').read_text().splitlines()
in_services=False; service=None; counts={'backend':0,'web':0}
for i,line in enumerate(lines):
    root=re.match(r'^([A-Za-z0-9_-]+):',line)
    if root:
        in_services=root.group(1)=='services'; service=None
    match=re.match(r'^  ([A-Za-z0-9_-]+):\s*$',line)
    if in_services and match: service=match.group(1)
    if in_services and service in counts and re.match(r'^    image:',line):
        lines[i]=f'    image: dive-testing-{service}:{rid}'
        counts[service]+=1
if counts!={'backend':1,'web':1}: raise SystemExit('Unexpected image configuration. No service changes made.')
if test_guests == 'true':
    start=lines.index('  backend:')
    end=next((i for i in range(start+1,len(lines)) if re.match(r'^  [A-Za-z0-9_-]+:',lines[i])),len(lines))
    block=lines[start:end]
    if '    environment:' not in block: raise SystemExit('Expected backend environment mapping.')
    settings={'APP_DEPLOYMENT_MODE':'testing','DISCLAIMER_TEST_GUESTS':'true','ENABLE_WATER_SPORTS':'true'}
    for key,value in settings.items():
        matching=[i for i,line in enumerate(block) if re.match(r'^      '+key+r':',line)]
        if len(matching)>1: raise SystemExit('Duplicate testing environment setting.')
        if matching: block[matching[0]]=f'      {key}: "{value}"'
        else: block.insert(block.index('    environment:')+1,f'      {key}: "{value}"')
    lines[start:end]=block
(release/'compose.next.yaml').write_text('\n'.join(lines)+'\n')
PY
docker compose --project-directory "$root" -p "$project" --env-file "$root/.env.testing" \
  -f "$release_dir/compose.next.yaml" config --quiet

printf '\nRehearsing database migrations on an isolated testing clone.\n'
make_backup "$release_dir/rehearsal-backup.log"
admin_sql <<'SQL'
SELECT format('CREATE DATABASE %I OWNER dive_center_testing', :'candidate') \gexec
SQL
clone_created=1
restore_dump "$backup_path/testing.dump" "$clone_database"
python3 - "$root/secrets/database_url" "$release_dir/rehearsal_database_url" "$clone_database" <<'PY'
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import sys
source=urlsplit(Path(sys.argv[1]).read_text().strip())
if source.hostname!='db' or source.path!='/dive_center_testing': raise SystemExit('Unexpected testing datasource.')
Path(sys.argv[2]).write_text(urlunsplit((source.scheme,source.netloc,'/'+sys.argv[3],source.query,source.fragment))+'\n')
Path(sys.argv[2]).chmod(0o444)
PY
fingerprint "$old_backend_image" "$release_dir/rehearsal_database_url" > "$release_dir/rehearsal-accounts.before.json"
run_image "$new_backend" "$release_dir/rehearsal_database_url" node tools/prisma.cjs migrate deploy
fingerprint "$new_backend" "$release_dir/rehearsal_database_url" > "$release_dir/rehearsal-accounts.after.json"
diff -u "$release_dir/rehearsal-accounts.before.json" "$release_dir/rehearsal-accounts.after.json"
verify_crypto "$new_backend" "$release_dir/rehearsal_database_url"
cleanup_clone
printf 'Migration rehearsal passed; testing accounts and bindings preserved.\n'

printf '\nBrief testing-only maintenance window begins.\n'
frozen=1
compose stop web backend
make_backup "$release_dir/final-backup.log"
final_backup="$backup_path"
fingerprint "$old_backend_image" "$root/secrets/database_url" > "$release_dir/accounts.before.json"
migration_started=1
run_image "$new_backend" "$root/secrets/database_url" node tools/prisma.cjs migrate deploy
fingerprint "$new_backend" "$root/secrets/database_url" > "$release_dir/accounts.after.json"
diff -u "$release_dir/accounts.before.json" "$release_dir/accounts.after.json"
verify_crypto "$new_backend" "$root/secrets/database_url"
cp "$release_dir/compose.next.yaml" "$root/compose.yaml"
compose config --quiet
compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 backend
compose exec -T backend node -e '
(async()=>{if(process.env.TESTING_LIVE_AUTH!=="false")throw Error("Live auth enabled");const r=await fetch("http://127.0.0.1:5001/api/ready");console.log("Testing readiness:",r.status,await r.text());if(!r.ok)process.exitCode=1;})().catch(()=>{console.error("Readiness failed");process.exitCode=1;});
'
compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 web
# The site is now available to testers. Do not roll back later reporting errors.
frozen=0
printf '%s\n' "$release_id" > "$root/ACTIVE_TESTING_RELEASE"
printf '%s\n' "$release_id" > "$release_dir/COMPLETED"
compose ps
df -h /
printf '\nTesting update complete: %s\n' "$release_id"
printf 'Site: https://diving-staging.ssrsys.com\n'
printf 'Existing testing usernames, password hashes, authenticator records and keys were preserved.\n'
printf 'Pre-update backup: %s\n' "$final_backup"
printf 'Production was not a deployment target. No proxy changes are required.\n'
)

#!/bin/sh
# No command in this script builds, migrates, stops, or deletes the live backend/DB.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[ -f .env.testing ] && [ -f .env.parallel-live ] || { echo 'Run node scripts/prepare-parallel-testing.cjs first.' >&2; exit 1; }
# Parse data as dotenv, never source an environment file as shell code.
setting() { node -e 'const fs=require("node:fs");const {parseEnv}=require("node:util");const v=parseEnv(fs.readFileSync(".env.parallel-live","utf8"))[process.argv[1]];if(!v)process.exit(1);process.stdout.write(v)' "$1"; }
mode=$(setting PARALLEL_PROXY_MODE)
project=$(setting LIVE_COMPOSE_PROJECT)
case "$mode" in relay|split) ;; *) echo 'Invalid saved proxy mode.' >&2; exit 1;; esac
case "$project" in ''|*[!a-z0-9_-]*) echo 'Invalid saved live project.' >&2; exit 1;; esac
live() {
  if [ "$mode" = relay ]; then
    docker compose --project-directory "$root" -p "$project" --env-file .env.production --env-file .env.testing --env-file .env.parallel-live -f compose.yaml -f deploy/compose.proxy-relay.yaml -f deploy/compose.frozen-live.yaml "$@"
  else
    docker compose --project-directory "$root" -p "$project" --env-file .env.production --env-file .env.testing --env-file .env.parallel-live -f compose.yaml -f deploy/compose.frozen-live.yaml "$@"
  fi
}
parallel() {
  if [ "$mode" = relay ]; then
    live -f deploy/compose.parallel-live.yaml -f deploy/compose.parallel-relay.yaml "$@"
  else
    live -f deploy/compose.parallel-live.yaml "$@"
  fi
}
testing() {
  docker compose --project-directory "$root" -p dive-centre-testing --env-file .env.production --env-file .env.testing -f deploy/compose.testing.yaml "$@"
}
case "${1:-}" in
  start)
    # Verify the snapshot still identifies the running release before making changes.
    node scripts/prepare-parallel-testing.cjs
    testing config --quiet
    parallel config --quiet
    testing build testbackend testweb
    testing up -d --wait --wait-timeout 180
    parallel run --rm --no-deps --entrypoint caddy parallel-config-check validate --config /etc/caddy/Caddyfile --adapter caddyfile
    # Recreate only the web router, using its FROZEN image, and never its dependencies.
    parallel up -d --no-deps --no-build web
    echo 'Testing enabled. Open the live URL with /?version=choose or /?version=testing.'
    ;;
  users)
    live exec -T backend /app/entrypoint.sh node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.user.findMany({where:{isActive:true,deletedAt:null,authenticator:{is:{enrolledAt:{not:null}}}},select:{username:true,name:true,role:true},orderBy:{username:"asc"}}).then(users=>console.log(JSON.stringify(users,null,2))).catch(()=>{console.error("Could not list live users.");process.exitCode=1}).finally(()=>p.$disconnect())'
    ;;
  allow)
    shift
    [ "$#" -gt 0 ] || { echo 'List ALL usernames to allow, or use allow --none.' >&2; exit 1; }
    if [ "$#" -eq 1 ] && [ "$1" = --none ]; then
      selection='[]'
    else
      selection=$(live exec -T backend /app/entrypoint.sh node -e 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();const names=[...new Set(process.argv.slice(1))];(async()=>{if(!names.length||names.length>200)throw Error();const users=await p.user.findMany({where:{username:{in:names},isActive:true,deletedAt:null,mustChangePassword:false,authenticator:{is:{enrolledAt:{not:null}}}},select:{id:true,username:true}});if(users.length!==names.length)throw Error();console.log(JSON.stringify(users))})().catch(()=>{console.error("Every selected username must exist, be active, and have completed password/authenticator setup in live. The list was unchanged.");process.exitCode=1}).finally(()=>p.$disconnect())' -- "$@")
    fi
    node scripts/write-testing-allowlist.cjs "$selection"
    ;;
  bootstrap)
    echo 'Testing now uses selected live accounts. Use users, then allow <live-usernames>, and connect live sign-in in the browser.' >&2
    exit 1
    ;;
  status)
    parallel ps web backend db
    testing ps
    ;;
  stop)
    # Remove testing routes BEFORE stopping the testing stack. Keep the data volume.
    live up -d --no-deps --no-build web
    testing down
    echo 'Testing routes and containers removed. Testing data and frozen live images retained.'
    ;;
  *) echo 'Usage: sh scripts/parallel-testing.sh start|users|allow <live-usernames>|allow --none|status|stop' >&2; exit 1;;
esac

#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[ -f .env.production ] || { echo 'Missing .env.production.' >&2; exit 1; }
if [ -L backups ] || { [ -e backups ] && [ ! -d backups ]; }; then
  echo 'backups must be a private directory, not a symbolic link.' >&2; exit 1
fi
mkdir -p backups
chmod 700 backups
partial=$(mktemp "$root/backups/.production-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
trap 'rm -f "$partial"' 0
trap 'exit 1' HUP INT TERM
# A direct redirect preserves pg_dump's exit status; no pipeline can hide failure.
docker compose --env-file .env.production exec -T db sh -eu -c '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec pg_dump --host=127.0.0.1 --username=dive_center --dbname=dive_center --format=custom --no-owner --no-acl
' > "$partial"
[ -s "$partial" ] || { echo 'Backup was empty.' >&2; exit 1; }
docker compose --env-file .env.production exec -T db pg_restore --list < "$partial" > /dev/null
name=${partial##*/}
archive=$root/backups/${name#.}.dump
mv "$partial" "$archive"
printf '%s\n' "$archive"

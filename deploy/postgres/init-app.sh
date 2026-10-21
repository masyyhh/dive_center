#!/bin/sh
set -eu
app_password=$(cat /run/secrets/database_password)
# Generated secrets are hex; validation makes SQL construction unambiguous.
case "$app_password" in ''|*[!0-9a-f]*) echo 'Invalid application database password secret.' >&2; exit 1;; esac
[ ${#app_password} -eq 64 ] || exit 1
{
  printf "CREATE ROLE dive_center LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '%s';\n" "$app_password"
  printf 'CREATE DATABASE dive_center OWNER dive_center;\n'
  printf 'REVOKE CONNECT ON DATABASE dive_center FROM PUBLIC;\n'
  printf 'GRANT CONNECT ON DATABASE dive_center TO dive_center;\n'
} | psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1

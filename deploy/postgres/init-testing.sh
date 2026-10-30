#!/bin/sh
set -eu
password=$(cat /run/secrets/testing_database_password)
case "$password" in ''|*[!0-9a-f]*) echo 'Invalid testing database password.' >&2; exit 1;; esac
[ ${#password} -eq 64 ] || exit 1
{
  printf "CREATE ROLE dive_center_testing LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '%s';\n" "$password"
  printf 'CREATE DATABASE dive_center_testing OWNER dive_center_testing;\n'
  printf 'REVOKE CONNECT ON DATABASE dive_center_testing FROM PUBLIC;\n'
  printf 'GRANT CONNECT ON DATABASE dive_center_testing TO dive_center_testing;\n'
} | psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1

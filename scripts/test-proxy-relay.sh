#!/bin/sh
# Run only after smoke-production.sh in the same disposable CI project.
set -eu
[ "${CI:-}" = true ] || { echo 'Run only in disposable CI.' >&2; exit 1; }
case "${COMPOSE_PROJECT_NAME:-}" in dive-ci-*) ;; *) echo 'A unique dive-ci-* Compose project is required.' >&2; exit 1;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
# Give the NPM stand-in one exact address on a disposable fixture network.
export NPM_PROXY_IP=172.30.251.4
export PROXY_RELAY_SUBNET=172.30.251.0/29
export PROXY_RELAY_CADDY_IP=172.30.251.2
export PROXY_RELAY_BACKEND_IP=172.30.251.3
compose() { docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml "$@"; }
compose config --quiet
compose up -d --no-deps --wait --wait-timeout 120 backend web
binding=$(compose port backend 5001 2>/dev/null || true)
[ -z "$binding" ] || { echo 'Relay mode must not publish the Node port.' >&2; exit 1; }
# A direct client cannot bypass the NPM check with forged proxy headers.
status=$(curl --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 -o /dev/null -w '%{http_code}' \
  -H 'X-Forwarded-Proto: https' -H 'X-Forwarded-For: 172.30.251.4' \
  http://127.0.0.1:8080/api/users)
[ "$status" = 403 ] || { echo "Untrusted peer returned $status instead of 403." >&2; exit 1; }
backend_image=$(compose images -q backend)
docker run --rm --network "${COMPOSE_PROJECT_NAME}_proxy_relay" --ip "$NPM_PROXY_IP" \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint node "$backend_image" -e '
const assert = require("node:assert/strict");
(async () => {
  const base = "http://web:8080";
  for (const proto of [undefined, "http"]) {
    const headers = proto ? { "X-Forwarded-Proto": proto } : {};
    assert.equal((await fetch(`${base}/api/users`, { headers })).status, 403);
  }
  const headers = { "X-Forwarded-Proto": "https", "X-Forwarded-For": "198.51.100.25" };
  const home = await fetch(`${base}/`, { headers });
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(home.headers.get("content-security-policy"), /default-src/);
  assert.equal((await fetch(`${base}/api/ready`, { headers })).status, 200);
  const users = await fetch(`${base}/api/users`, { headers });
  assert.equal(users.status, 401);
  assert.equal(users.headers.get("cache-control"), "no-store");
  console.log("NPM relay: trusted HTTPS reaches frontend/API; untrusted peers and missing/insecure protocol are rejected.");
})().catch(error => { console.error(error); process.exitCode = 1; });
'

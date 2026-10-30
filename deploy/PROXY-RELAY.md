# Existing Nginx Proxy Manager forwarding everything to 8080

Use this mode when you cannot change NPM's routing. NPM continues sending the
whole HTTPS application to the application server's HTTP port 8080. Caddy
serves React and forwards `/api` and `/api/*` to Node over Docker networking.
Caddy never requests certificates. NPM remains responsible for public TLS.

Keep the existing secrets, database volume and domain/CORS settings. In the
application server's private `.env.production`, set:

```dotenv
NPM_PROXY_IP=192.168.135.63
```

Use that example only if it is the actual NPM source address seen by Caddy.
It must be one exact IPv4 or IPv6 address (no subnet, wildcard or list).
`REVERSE_PROXY_BIND_IP` remains the application server's private IP. Existing
`REVERSE_PROXY_TRUSTED_IPS` is not used by this override: Node trusts only the
fixed Caddy address. The backend's host port 5001 is removed.

Caddy rejects connections from other sources and requires NPM to report
`X-Forwarded-Proto: https`. It parses forwarded client IPs from right to left
and replaces the upstream XFF chain with one parsed address. Node retains its
proxy-only HTTPS gate, authentication, RBAC, request limits and rate limits.
These controls do not replace the firewall or encrypt the NPM-to-app hop.
Restrict port 8080 to NPM on a trusted private network/VPN; keep 5432 private.
If NPM forwards a CDN's IP rather than the visitor IP, logs/rate limits may
identify that CDN address. Do not broaden trusted networks to work around it.

The relay uses subnet `172.30.251.0/29` and fixed Caddy IP `172.30.251.2` by
default. If that overlaps another Docker/VPN/LAN network, choose an unused
private subnet via `PROXY_RELAY_SUBNET` and an address inside it via
`PROXY_RELAY_CADDY_IP`. Set `PROXY_RELAY_BACKEND_IP` to a different address in the same subnet as well
(default `172.30.251.3`). All three settings must stay consistent. Do not hardcode the
previous ephemeral `172.18.0.4` address or trust a whole Docker subnet.

## Update an existing installation

Require Docker Compose 2.24.4+. Review the release CI result before deployment.
Back up the existing database and matching secrets using PRODUCTION.md. From
`/srv/dive-centre`, after updating the source and private environment:

```sh
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml config --quiet
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml build backend web
# Validate Caddy syntax and environment substitution before downtime.
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Maintenance window: stop writes before taking the final backup.
docker compose --env-file .env.production stop web backend
sh scripts/backup.sh
# Continue only when backup succeeded. Leave the database running.
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.proxy-relay.yaml up -d --no-deps --wait --wait-timeout 120 backend web
```

Always use `-f compose.yaml -f deploy/compose.proxy-relay.yaml` for updates.
Do not combine this mode with the older split-routing overrides.

Verify `https://diving.ssrsys.com/api/ready` returns 200 and `/api/users`
without a token returns 401. Test real sign-in and inspect audit client IPs.
The Compose port list must show only 8080 published for the application, with
no host mapping for 5001. Requests to 8080 from other sources must fail even
with forged forwarded headers. Missing/non-HTTPS forwarded protocol from NPM
must fail. If source IP validation fails, determine the source seen by Caddy;
do not disable the checks. No NPM administration access is required unless
it is not already forwarding to 8080 or does not send the HTTPS header.

To verify the NPM source before changing the allowlist, capture connection
metadata in Caddy's network namespace while refreshing the public domain:

```sh
web_container=$(docker compose --env-file .env.production ps -q web)
web_pid=$(docker inspect --format '{{.State.Pid}}' "$web_container")
sudo timeout 30 nsenter -t "$web_pid" -n tcpdump -nn -i any -c 10 'tcp dst port 8080'
```

Use the source IP on inbound packets, after confirming the request came
through the public domain/NPM. This prints packet metadata, not HTTP bodies
or authorization headers. Do not trust the backend capture's Caddy address.

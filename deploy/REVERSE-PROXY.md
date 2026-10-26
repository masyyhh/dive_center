# External reverse proxy on a private network

Use this mode when another server terminates public HTTPS and this application
server provides both the React website and Node API. The external proxy routes
`/api` and `/api/*` to port 5001, and all other paths to port 8080. Port 5001 is
the API only; pointing the entire website at it will not serve React.

## Temporary access from any source IP

When the server and proxy private IPs are not yet known, use the separate
`deploy/compose.reverse-proxy-open.yaml` override. It publishes HTTP ports
5001 (API) and 8080 (website with API forwarding) on all IPv4 interfaces without a source-IP
allowlist. It replaces the server's public Caddy 80/443 mappings. No IP variables
are required. Network/provider firewalls still need to permit those ports;
Compose does not modify those external firewalls.

```sh
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.reverse-proxy-open.yaml config --quiet
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.reverse-proxy-open.yaml up -d --build --wait backend web
```

This mode deliberately disables proxy-only enforcement and forwarded-header
trust; it does not disable authentication, authorization, rate limits, audit
logging, security headers or request limits. Rate limits and audit IPs use the
actual TCP peer, so users behind the same proxy share its rate limit bucket.
The proxy routing example below still applies. Public users should use the
proxy's HTTPS domain; these HTTP upstreams do not encrypt passwords or tokens.
Port 8080 forwards `/api` and `/api/*` to Node, so temporary direct access to
`http://SERVER_IP:8080` works for the website and API on the same origin.
Requests through Caddy share its backend rate-limit bucket while forwarded
header trust is disabled. The external proxy can either forward the entire
origin to 8080 in this temporary mode, or use the split routing example below.

When the addresses become available, configure the private bind IP and trusted
proxy IP below, restrict network access, and switch from the open override to
`deploy/compose.reverse-proxy.yaml`. Never combine the two overrides.

## Network and TLS boundary

Restrict inbound TCP 5001 and 8080 to the reverse proxy's private source IP at
the provider/network firewall. Bind the published ports to this server's private
IP, never `0.0.0.0`. Binding a private IP alone does not restrict which private
clients can connect. Docker-published ports can bypass ordinary UFW INPUT rules;
use an upstream ACL or Docker-aware forwarding rules (DOCKER-USER for iptables,
or the equivalent for the host's Docker firewall backend). Do not publish 5432.

The outer proxy must terminate valid HTTPS, redirect HTTP to HTTPS, and overwrite
client-supplied X-Forwarded-For, X-Forwarded-Proto and X-Forwarded-Host. Do not
append arbitrary incoming forwarded headers on a single public proxy. Set
X-Forwarded-For to the actual connected client, X-Forwarded-Proto to `https` on
the TLS listener, and Host/X-Forwarded-Host to the public application hostname.
Enforce a 5 MB request limit and reasonable connection/request timeouts there.
Set HSTS on the public HTTPS listener. Keep admin/control endpoints private.

HTTP upstreams must stay on the restricted private network; use a VPN or
authenticated TLS upstreams if that network is not trusted. The checks in Node
do not encrypt traffic or replace a firewall. CORS is browser policy, not an
access control for direct clients.

## Configuration

Keep the existing secrets, database volume and HTTPS CORS origin. Add to the
private `.env.production` (replace documentation addresses before starting):

```dotenv
APP_DOMAIN=diving.ssrsys.com
CORS_ORIGIN=https://diving.ssrsys.com
REVERSE_PROXY_BIND_IP=10.20.0.20
REVERSE_PROXY_TRUSTED_IPS=10.20.0.10
```

The bind IP belongs to this application server; the trusted IP belongs to the
reverse proxy. Node trusts comma-separated explicit IPs/CIDRs, not arbitrary
hop counts, wildcard aliases or /0 networks. Prefer exact IPs. If Docker/NAT
changes the connection's source, use the source actually seen by Node and
restrict access before that NAT boundary. Do not trust the entire Docker or
private subnet to work around a 403.

The override defaults to loopback when the bind IP is omitted and refuses to
start without the trusted proxy address. It replaces the web port mappings,
removing public 80/443 from this server. It disables Caddy's certificate
issuance and uses Caddy to serve the website over HTTP on port 8080. In the
restricted mode, keep the split routing below: API requests forwarded through
Caddy are rejected unless its source address is explicitly trusted as well.
The Node gate rejects non-proxy API clients and requires forwarded HTTPS,
except for read-only health/readiness probes. API responses use no-store.
Existing authentication, RBAC, rate limits, audit logging, request body limits,
security headers and container privilege restrictions remain active.

Require Docker Compose 2.24.4 or newer for port replacement. From the repo root:

```sh
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.reverse-proxy.yaml config --quiet
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.reverse-proxy.yaml up -d --build --wait backend web
docker compose --env-file .env.production -f compose.yaml -f deploy/compose.reverse-proxy.yaml ps
```

Use both `-f` arguments for subsequent updates so the deployment stays in this
mode. Do not run the base Compose `up` alone, which restores Caddy public HTTPS.

## Proxy routing example (Nginx HTTPS server block)

Adapt to the actual proxy product. Insert this in the existing TLS server block
for `diving.ssrsys.com`; certificate configuration belongs to that proxy.
Replace `10.20.0.20` with the application server's private IP.

```nginx
client_max_body_size 5m;
add_header Strict-Transport-Security "max-age=31536000" always;

proxy_set_header Host diving.ssrsys.com;
proxy_set_header X-Forwarded-Host diving.ssrsys.com;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto https;
proxy_connect_timeout 5s;
proxy_read_timeout 60s;

location = /api {
    proxy_pass http://10.20.0.20:5001;
}
location /api/ {
    proxy_pass http://10.20.0.20:5001;
}
location / {
    proxy_pass http://10.20.0.20:8080;
}
```

Preserve the `/api` prefix when forwarding. Disable proxy caching for API
responses and preserve Authorization and X-Property-Id request headers.
The fixed forwarded values above belong only to the HTTPS listener; the HTTP
listener should redirect to the HTTPS hostname without forwarding API bodies.

## Verification before using real accounts

From the proxy server, `/api/ready` on port 5001 must return 200, `/` on 8080
must serve HTML, and `/api/ready` on 8080 must return 200. An API request through
the trusted proxy with `X-Forwarded-Proto: https` reaches normal authentication
(e.g. `/api/users` returns 401 without a token). Without the HTTPS header it
returns 403. From other private/public hosts, firewall rules must prevent TCP
connections to both ports. From the public domain, verify TLS, frontend assets,
login, property creation and API readiness. Check audit IPs identify the real
client. Confirm public 80/443 terminate only at the intended external proxy.

The app's authenticator enrollment/recovery feature does not enforce an OTP
challenge at every login. If sign-in MFA is required, enforce it at the external
identity/access proxy or implement a separate reviewed application change.

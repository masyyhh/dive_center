# Production hosting guide

This guide deploys a small, single-server installation using PostgreSQL 18, the Node API and Caddy HTTPS. It is not a high-availability design. The database persists in the `postgres_data` Docker volume at `/var/lib/postgresql`; only Caddy publishes host ports. Use a separate staging server/project before admitting real guests or financial records.

## 1. Release gate

Ship a reviewed Git commit containing the application, `scripts/`, `deploy/`, tests and **all** PostgreSQL migrations. Untracked files in your development checkout are not included when a server clones Git. Do not copy `.local/`, `.env.local`, databases, backups or workstation `node_modules` to a server.

The workflow in `.github/workflows/ci.yml` runs root deployment-tool tests, the full backend/frontend suites, builds and a disposable Docker smoke test. The smoke test migrates an empty database, bootstraps/enrolls an administrator, exercises billing/attendance/export/locking, creates a backup, restores it into a separate database and compares all application model data, authenticator decryption and the live-check unique index.

A green CI run for the exact release commit is required. The CI-only `deploy/compose.smoke.yaml` disables HTTPS and must **never** be used for public hosting. The smoke tools create fixture records and refuse normal non-CI execution.

Local verification with Node 22.13+ or Node 24 and an explicitly separate `_test` PostgreSQL database:

```sh
node --test tests/*.test.cjs
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
```

Integration tests create and remove random schemas in `TEST_DATABASE_URL`. Never point them at production. Dependency advisories and reviewed base-image updates must also be checked before release. Do not describe an unrun CI/container check as passed.

## 2. Prepare the host and domain

Use a supported Ubuntu LTS server and Docker Engine with the Compose v2 plugin. A reasonable initial estimate for a small internal installation is 2 vCPUs, 4 GB RAM and SSD storage; measure actual usage and database/backup growth before selecting final capacity. This estimate is not a load-test result.

- Install Docker from its [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/), including Buildx and the Compose plugin. Avoid the convenience installer for production.
- Use a dedicated deployment account, SSH keys, restricted administrator access and a private checkout such as `/srv/dive-centre`. Docker access is effectively root-level access; grant it only to trusted operators. Do not expose the Docker daemon remotely.
- Restrict SSH to your administrator IPs/VPN. In the provider firewall permit TCP 80/443 publicly and optionally UDP 443 for HTTP/3. Do not open PostgreSQL 5432 or backend 5001. Docker-published ports can bypass UFW: enforce provider firewall rules and review Docker's [port-publishing behavior](https://docs.docker.com/engine/network/port-publishing/).
- Point your application domain's A record at the VPS. Publish an AAAA record only if IPv6 reaches the same server and is correctly firewalled. Ensure outbound DNS/HTTPS and clock synchronization work.
- Enable host security updates and plan/rehearse reboots. Monitor disk, memory, service health and certificate expiry externally.

Caddy obtains/renews certificates and redirects HTTP to HTTPS when the configured domain resolves correctly and ports 80/443 are reachable. See [Caddy HTTPS requirements](https://caddyserver.com/docs/quick-starts/https).

Verify the tools before preparing configuration:

```sh
docker version
docker compose version
```

## 3. Create private configuration

From the repository root, with Node 22 or 24 on the host:

**Option A: With a registered domain (automatic HTTPS via Let's Encrypt / ZeroSSL):**

```sh
umask 077
node scripts/prepare-production.cjs dive.your-domain.com admin@your-domain.com
```

**Option B: Without a domain (HTTP on port 80 using server IP or hostname):**

```sh
umask 077
# Pass your VPS / server IP, or --no-domain:
node scripts/prepare-production.cjs 192.168.1.50 admin@your-domain.com
# or:
# node scripts/prepare-production.cjs --no-domain admin@your-domain.com
```

If Node is not installed on the host, the equivalent uses the official Node image as your own UID/GID:

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  --volume "$PWD:/workspace" --workdir /workspace \
  node:22-bookworm-slim \
  node scripts/prepare-production.cjs --no-domain admin@your-domain.com
```

Preparation creates `.env.production` (0600) and `secrets/` (0700) with independently generated signing, encryption, app/admin database and bootstrap passwords. Existing keys/configuration are preserved; inconsistent existing database credentials fail rather than being silently replaced. Secret files are 0444 inside the private parent so nonroot containers can read their selected mounts. Do not loosen the directory's permissions. Keep the checkout on a private local filesystem; verify host ACLs as well as modes.

Review `.env.production` privately:
- In no-domain mode, `APP_DOMAIN` is `:80` and `CORS_ORIGIN` is configured for HTTP. Caddy binds port 80 for HTTP without attempting ACME certificates.
- In domain mode, `APP_DOMAIN` contains the FQDN and Caddy automatically manages certificates and redirects HTTP to HTTPS.
- When an application domain is acquired later, simply update `APP_DOMAIN=dive.your-domain.com` in `.env.production` and run `docker compose up -d` to switch to HTTPS seamlessly.
- Use `docker compose ... config --quiet` to validate without printing interpolated configuration.

For optional PMS lookup, edit the private `secrets/pms_api_key` file using a trusted editor/password manager. It is empty by default, disabling lookup. Temporarily make it owner-writable to edit, then return it to 0444. Never put the value in shell history, frontend settings, Git, issue reports or logs. Earlier configurations using `.env.production`'s `PMS_API_KEY` must move the value to this file; Compose now reads `PMS_API_KEY_FILE`. Direct deployments may use either raw value or `_FILE`, never both. Resort mappings are editable only by global administrators.

`AUTHENTICATOR_ENCRYPTION_KEY` must remain stable. Back it up encrypted with the database; losing it makes existing authenticator bindings unreadable. For an existing installation, preserve its original key **before** preparation. Changing password files does not rotate PostgreSQL passwords on an already initialized volume.

For repeatable releases, set optional `NODE_IMAGE`, `POSTGRES_IMAGE` and `CADDY_IMAGE` in `.env.production` to reviewed `name:tag@sha256:<actual-digest>` references. The defaults are supported major-version tags; resolve/record real digests from your registry rather than copying placeholder digests. Rebuild reviewed updates regularly and test before rollout.

## 4. Fresh installation

Do not bootstrap if importing an existing application database. For SQLite data, follow [SQLITE-TO-POSTGRESQL.md](SQLITE-TO-POSTGRESQL.md), keep the original authenticator key and skip administrator creation.

For a genuinely empty installation:

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build --pull
docker compose --env-file .env.production up -d --wait --wait-timeout 120 db
docker compose --env-file .env.production run --rm backend npm run migrate:deploy

# This override mounts the bootstrap password only for the one-off container.
docker compose --env-file .env.production \
  -f compose.yaml -f deploy/compose.bootstrap.yaml \
  run --rm backend npm run bootstrap:admin

docker compose --env-file .env.production up -d --wait --wait-timeout 120
```

Never pass `compose.bootstrap.yaml` to the long-running `up` command. The normal API container does not mount the bootstrap password. Bootstrap refuses to overwrite an existing global administrator. Read `secrets/admin_password` privately, sign in with `ADMIN_EMAIL`, enroll the personal authenticator and store recovery codes in a password manager. Replace the bootstrap password through account administration after setup.

Authenticator enrollment gates workspace access and supports password recovery/replacement. Normal sign-in is password-only; this application does **not** enforce an OTP challenge at every login. If sign-in MFA is a business requirement, do not expose the application until an appropriate identity/access layer or application login change has been implemented and tested.

Create properties, catalogue entries, managers and operational accounts through Administration. Login accounts and staff roster records are separate. No demo seeding runs in production.

## 5. Verify staging before opening production

```sh
docker compose --env-file .env.production ps
# For domain / HTTPS:
# curl --fail https://dive.your-domain.com/api/health
# curl --fail https://dive.your-domain.com/api/ready
# curl --head https://dive.your-domain.com/

# For no-domain / HTTP (port 80 or IP):
curl --fail http://127.0.0.1/api/health
curl --fail http://127.0.0.1/api/ready
curl --head http://127.0.0.1/
```

Confirm public HTTPS, HTTP redirect, expected CSP/security headers and automatic certificate management. The readiness endpoint must return 200, and unauthenticated sensitive APIs must return 401. In the browser, exercise sign-in/enrollment/recovery, manager/staff permissions across two properties, bill creation/re-date/rebate/delete, attendance, payroll locks and daily/monthly exports. Check a shared-occupant PMS room and provider failure if that integration is enabled. Use fixture-only data in staging.

Run a backup and restore rehearsal below before go-live. Confirm that notifications reach an operator when readiness fails, disk fills, backup/off-site transfer fails or repeated account attacks occur. Container logs rotate at 10 MB × 3 per service; that is not a complete security-log retention or alerting system. Define audit/export/guest-data retention and access policies for your business.

## 6. Backups and off-site protection

```sh
sh scripts/backup.sh
```

The script creates a private custom-format archive under `backups/`, preserves `pg_dump` failure status, rejects empty/unreadable archives and publishes a unique `.dump` filename only after `pg_restore --list` succeeds. Hidden temporary files are cleaned on failures. It does not delete old backups, encrypt them or transfer them off-host. Archive readability alone does not prove restorability; rehearse full restores.

Define a recovery point objective and choose a matching frequency (for example daily only if losing up to a day is acceptable). Use encrypted off-site storage with separate credentials, restricted deletion/immutable retention where available and an alert for stale or failed backups. Keep encrypted copies of `.env.production` and the matching `secrets/` accessible to recovery operators; retain the previous release commit/image identities. Never upload secrets unencrypted or rely on a copy on the same VPS as your only backup.

An optional systemd schedule for a checkout at `/srv/dive-centre`:

```ini
# /etc/systemd/system/dive-centre-backup.service
[Unit]
Description=Dive Centre PostgreSQL backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=dive
WorkingDirectory=/srv/dive-centre
UMask=0077
ExecStart=/bin/sh /srv/dive-centre/scripts/backup.sh
```

```ini
# /etc/systemd/system/dive-centre-backup.timer
[Unit]
Description=Daily Dive Centre backup

[Timer]
OnCalendar=*-*-* 02:15:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

Adjust the account/path and schedule, then have an operator install/enable the units and configure an off-site transfer plus failure alerts. The `dive` account needs trusted Docker access. This schedule uses UTC explicitly. A successful local service is not proof that off-site transfer succeeded. For point-in-time recovery or high availability, choose a database/backup architecture that provides those properties; this single-server guide does not.

## 7. Restore rehearsal and disaster recovery

Use a separate private VPS or isolated Compose project with new empty volumes. Restore the configuration and matching encryption key from encrypted storage, but set a distinct staging domain before starting its web service. Initialize its empty database, build the compatible application revision and keep `web`/`backend` stopped. Never test restores over the live application.

To restore into that **empty recovery installation**, run:

```sh
docker compose --env-file .env.production up -d --wait db
docker compose --env-file .env.production exec -T db sh -eu -c '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec pg_restore --host=127.0.0.1 --username=dive_center --dbname=dive_center \
    --no-owner --no-acl --exit-on-error --single-transaction
' < /private/path/to/SELECTED.dump

docker compose --env-file .env.production run --rm backend npm run migrate:deploy
docker compose --env-file .env.production up -d --wait --wait-timeout 120
```

The command deliberately omits `--clean`: a populated target must fail rather than be silently replaced. An overwrite recovery needs a separate reviewed plan and verified backup of its current contents. Restore includes application schema/data and migration history; run migrations for the chosen application revision afterward. Verify account recovery, authenticator decryption, business-record totals, exports and permissions before routing production DNS or admitting users. Record measured recovery time.

Never run `docker compose down --volumes` or `down -v` against production; that destroys persistent database storage. CI removes only its disposable `dive-ci-*` volumes.

## 8. Upgrades and the security migration

Use a maintenance window. Take and verify an encrypted off-site backup of data and matching configuration, record current Git/image versions and stop user writes:

```sh
sh scripts/backup.sh
docker compose --env-file .env.production stop web backend
```

Before the `20261021000000_live_check_uniqueness` migration, check an existing database for duplicate live check numbers using this **read-only** query:

```sh
docker compose --env-file .env.production exec -T db sh -eu -c '
  export PGPASSWORD="$(cat /run/secrets/database_password)"
  exec psql --host=127.0.0.1 --username=dive_center --dbname=dive_center \
    --no-psqlrc --set ON_ERROR_STOP=1
' <<'SQL'
SELECT "propertyId", "checkNumber", count(*)
FROM "Bill"
WHERE "status" IN ('ACTIVE', 'REBATED')
GROUP BY "propertyId", "checkNumber"
HAVING count(*) > 1;
SQL
```

If rows are returned, stop the upgrade and resolve them with a reviewed business correction. The migration intentionally fails rather than deleting or renumbering financial records. After any failed migration, inspect `prisma migrate status` and follow Prisma's documented failed-migration recovery; do not mark it applied without establishing the index exists.

Check out the reviewed release, preserve `.env.production`/`secrets/`, reconcile any configuration changes (including the PMS secret-file move), and run:

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build --pull
docker compose --env-file .env.production run --rm backend npm run migrate:deploy
docker compose --env-file .env.production up -d --wait --wait-timeout 120
```

Keep the previous release and backup for rollback. Roll back application images only when they are compatible with the migrated schema; otherwise recover into separate storage from the pre-upgrade backup and verify it before switching traffic. Never run `db push` against production: Prisma 5 cannot express the partial live-check index in its schema DSL, so PostgreSQL migrations are authoritative. Changing a PostgreSQL major version requires a planned database upgrade, not just a new image tag.

## Readiness and validation record

Local validation on 21 October 2026 passed all 104 tests (5 deployment-tool, 88 backend and 11 frontend), both TypeScript/frontend builds, fresh PostgreSQL migrations, compiled API smoke workflows and a real PostgreSQL custom-format backup/restore. Restored scalar data matched for every application model, authenticator decryption succeeded and the live-check unique index was present. This used fixture-only temporary databases and did not alter existing application data. No tests were excluded.

Source and local tests can establish application behavior, secret generation, backup failure handling and migration correctness in disposable PostgreSQL. They do not establish your DNS, firewall, TLS issuance, host ACLs, resource capacity, off-site backups or operator response. At release time record the successful CI run, staging checks, restore rehearsal and responsible operator. This workstation has no running Docker daemon/Compose plugin; no local container/startup/public-HTTPS success is claimed. Container execution is enforced by the added CI gate and must pass before deployment.

Authoritative references: [Docker installation](https://docs.docker.com/engine/install/ubuntu/), [Docker startup ordering](https://docs.docker.com/compose/how-tos/startup-order/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [PostgreSQL 18 image storage](https://hub.docker.com/_/postgres), [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

## Missing-column errors after an update

A Prisma `P2022` error naming `Property.pmsPropertyCodes` means the backend image expects a migration that has not been applied to its database. The migration `20261021010000_pms_resorts_staff_login` adds the PMS resort list and staff login link, preserving the old single-resort mapping.

After updating the server checkout to the intended release, run from its repository root:

```sh
docker compose --env-file .env.production build backend
docker compose --env-file .env.production run --rm backend node tools/prisma.cjs migrate deploy
docker compose --env-file .env.production up -d --wait --wait-timeout 120 backend web
```

Proceed to the next command only if the preceding command succeeds. These commands apply the bundled migrations to the existing database; they do not reset it. If migration deployment fails, inspect that error before restarting the API. Do not use `migrate reset`, delete the PostgreSQL volume, or mark an unapplied migration as applied.

The backend container now runs `migrate deploy` before its default API command, and refuses to start the API if migration deployment fails. One-off migration and bootstrap commands still run directly. Explicit migration deployment remains useful during a controlled release and when repairing an older running image.

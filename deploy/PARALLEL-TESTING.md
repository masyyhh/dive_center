# Parallel testing at the live URL

This setup keeps the **currently running live frontend and backend images**. Only the live web container's routing configuration changes; its existing `/srv` assets are preserved. The live backend and PostgreSQL container are not rebuilt, restarted or migrated by the testing helper.

Use the same HTTPS host:

- `/` — existing live version, unchanged by default.
- `/?version=choose` — version chooser (bookmark or share this with testers).
- `/?version=testing` — updated version at the original page path, with a testing banner and a return-to-live button.
- `/__testing/` — equivalent testing entry, also used for tablet links.

The original page is kept intact, so it does not gain a new button. The chooser provides access to both versions. Version selection is per URL/tab, not a cookie shared across every tab. Refreshing or navigating within a testing tab retains its selection. Test assets and API requests always use `/__testing/`; opening a live tab never switches a testing request to the live API.

## Before enabling

Use the deployment checkout containing the reviewed release commit and **all new files**, including migrations. Complete the CI checks for that commit. Run these commands on the application server while the original live containers are still running. Do **not** run a normal production build/up command for this release before capturing the running images.

The helper supports the existing base split-routing deployment or `compose.proxy-relay.yaml` deployment and detects the live Caddy mount. Other/custom overrides require review first. Compose 2.24.4+ and Node 22.13+ or 24 are required. The HTTPS proxy must send the query string and `/__testing/*` to the existing web upstream on port 8080; test APIs use that web upstream, not public port 5001. No new published ports or DNS entries are needed. Bypass any external proxy/CDN page caching for `version=testing`, `version=choose` and `/__testing/*`; caching keys must distinguish query strings. Caddy sends `no-store` on these responses.

```sh
cd /srv/dive-centre
node scripts/prepare-parallel-testing.cjs
sh scripts/parallel-testing.sh users
# Replace these examples with the exact live usernames printed above.
# Include at least one live administrator/manager for catalogue testing.
sh scripts/parallel-testing.sh allow 'admin@example.com' 'tester.username'
sh scripts/parallel-testing.sh start
sh scripts/parallel-testing.sh status
```

`prepare` records the actual running images under local frozen tags in `.env.parallel-live`. Keep those tags; avoid image pruning during testing. It refuses unrecognized proxy mounts or a changed running release on subsequent attempts. `start` is repeatable: it rebuilds only testing services, applies migrations only to the testing database, validates the new Caddy configuration and recreates only the frozen live web image with the new routes. This web recreation can briefly interrupt web requests; the live backend/database continue running.

If your deployment uses a custom `COMPOSE_PROJECT_NAME`, keep that value in the shell for the first preparation. The helper then records the actual project label and explicitly uses it. `.env.production` must retain the existing proxy IP/subnet settings, including `NPM_PROXY_IP` in relay mode.

Testing uses **selected live accounts**, not new passwords or authenticator enrollment. After opening `/?version=testing`, sign in to the original live version in another tab if necessary, then click **Connect live sign-in**. Its existing authenticator enrollment is verified by the live service. Local testing-password login, authenticator enrollment and recovery are disabled. Manage those in the live version.

`users` lists eligible active live usernames without passwords or authenticator secrets. `allow` replaces the entire selected list with exactly the usernames supplied; use exact usernames, including email-shaped usernames where applicable. It performs a read-only lookup against the running live backend/database and records immutable user IDs in `secrets-testing/allowed_live_users.json`. You can change the list while testing runs; removals are enforced on the user's next request. To revoke all testing access:

```sh
sh scripts/parallel-testing.sh allow --none
```

The server validates the live session and the selected-user list on every authenticated testing request. Live account deactivation, sign-out, password changes, authenticator reset, role changes and property assignment changes are therefore reflected at the next request. If live authentication is unavailable, testing access fails closed. Signing out **of testing** revokes only the separate testing session; it does not sign out live.

Only the selected user's identity and permitted property shells (name/code/currency/charge rates) are synchronized into testing. Live passwords, authenticator secrets, recovery codes, staff, guest bills, payroll and PMS configuration are never copied. Existing live roles are retained; selected centre staff do not become testing administrators. Create fictional staff/catalogue/bills for testing, or import an approved catalogue export. Live and testing bill sequences remain independent.

The testing session is an opaque random token with a four-hour expiry. Its live session reference is stored encrypted using the independent testing encryption key, solely for read-only `GET https://<APP_DOMAIN>/api/auth/me` verification. No live signing/encryption keys are mounted in testing. Testing account and business mutations never proxy to live. This verification may generate ordinary live authentication/audit activity. The server must be able to reach its existing public HTTPS domain from the testing backend; keep valid TLS verification enabled. Redirects are rejected. If your proxy uses additional access controls, ensure this verification request can reach `/api/auth/me` without changing or bypassing those controls.

## Isolation

- Separate Compose project: `dive-centre-testing`.
- Separate PostgreSQL database/role: `dive_center_testing`; independent volume `dive-centre-testing_testing_data`.
- Independent database passwords, session hashing key and session encryption key in `secrets-testing/`.
- No production database mounts, database credentials, or signing/encryption keys in testing containers. No test ports published.
- Separate browser token/property/theme keys and session bill drafts, including when account IDs happen to match.
- PMS lookup disabled (empty testing API key); database/frontend networks are internal. The testing backend has a separate outbound network for live HTTPS sign-in verification. Use fictional guest data.
- API/download/tablet requests stay on the testing backend. Test API proxy failures return errors; they do not fall back to live.

This is deployment isolation on the same origin, not a browser origin boundary. Serve only reviewed frontend code. Users with administrative access in testing manage only the testing database.

The testing frontend network defaults to `172.30.252.0/29`, with gateway `.2`, testing web `.3` and testing backend `.4`. If it overlaps existing Docker/VPN/private networks, change **all four** `TESTING_*` subnet/IP settings in `.env.testing` before first startup. The testing web accepts only the gateway IP, and the testing API accepts only its web IP. In relay mode, existing NPM peer and HTTPS checks run before any version route. Keep the original live relay addresses unchanged.

## Verify on the server

1. Open `/` and confirm the original UI, login and existing real records are intact.
2. Open `/?version=choose`, then testing. Confirm the testing banner, connect a selected live sign-in, and verify there are no live bills or payroll records. Property shells may already appear.
3. Keep live and testing open in separate tabs. Create a fictional test bill, then confirm it appears only in testing. Verify logouts/property selections remain independent.
4. Exercise automatic Photo charges, commission/pool calculations, bulk catalogue import/export, payroll and locked months in testing.
5. Try a nonselected user and remove a selected user to verify denial/revocation. Refresh the testing URL; open any generated tablet link if that feature is enabled. Verify they remain in testing.
6. Return to live using the banner. If anything is wrong, use the stop command below; it retains testing data.

## Updates during testing

Update the testing checkout to the next reviewed commit, then run:

```sh
sh scripts/parallel-testing.sh start
```

Do not run `docker compose ... build backend web` or an unqualified `up` against the live project during the trial. Those are normal release commands and would replace the original version. The helper deliberately uses frozen live images with `--no-deps --no-build` for its web routing change.

## Disable testing and roll back the router

```sh
sh scripts/parallel-testing.sh stop
```

This restores the original Caddy routes using the frozen live frontend **before** stopping/removing testing containers and networks. It keeps testing database data and secrets, including encrypted session references. Sign out of testing or remove selected access before archiving it if you do not want retained testing sessions. The root URL remains live; testing links no longer open the test version. `start` brings testing back with its retained data.

If startup fails after testing containers have started, the original live router remains unchanged until its final web recreation. Fix the reported error and retry, or use `stop`. Check container logs and `status` if the router cannot restart. Do not delete the frozen image tags or `.env.parallel-live` while rollback is needed.

## Promote the approved version

Promotion is a separate, explicit release, after testing signoff:

1. Take and verify a backup of the live database and private keys using the production runbook. Rehearse any migrations and review payroll changes against the backup.
2. Run `stop` to restore the normal routing and retain testing data.
3. Follow the normal production release procedure for the approved commit: build the live images, apply the approved migrations to **the existing live database**, and restart live services. Build without `VITE_DEPLOYMENT_MODE=testing` (the Dockerfile defaults to live).
4. Verify real records, billing, commission reports, authentication, and the original URL. Retain the backup and release images for rollback. A frontend rollback alone cannot undo data migrations or new live records.

Never replace the live database with the testing volume, and do not import fictional testing bills/payroll into live. Tested code/settings are promoted; testing records are disposable.

## Permanently remove testing after promotion

Only after live verification and any desired test-data backup, run `stop` **before promotion** as described above. Once production has been replaced, do not run the old helper again: its snapshot points at the previous release. To remove any remaining testing containers directly after promotion:

```sh
docker compose --project-directory . -p dive-centre-testing --env-file .env.production --env-file .env.testing -f deploy/compose.testing.yaml down
```

Inspect the testing volume before intentionally deleting it:

```sh
docker volume inspect dive-centre-testing_testing_data
# Irreversible: removes only the isolated testing database, once detached.
docker volume rm dive-centre-testing_testing_data
```

Then delete only `.env.testing`, `.env.parallel-live` and `secrets-testing/` once they are no longer needed. Remove the two recorded `dive-centre-frozen-*` image tags only when release rollback no longer needs them. Testing image tags can also be removed after checking no running containers use them. Never run `down --volumes` against the live project, and never delete `secrets/`, `.env.production` or the live PostgreSQL volume. The optional testing configuration files can remain unused in Git for future testing; their absence from the live Compose invocation leaves no testing routes or resources running.

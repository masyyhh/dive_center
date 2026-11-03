# Deploy the release without the package builder

This is an update of the existing production installation, not a new installation.
Production is `192.168.135.39`, application directory `/srv/dive-centre-prod`,
Compose project `dive-centre-prod`, database `dive_center`, and public site
`https://diving.ssrsys.com`.

## What this release changes

The administration package builder and the POST, PUT and DELETE package API
endpoints are removed in every environment. Existing packages remain readable
for billing. Package tables, migrations and historical bills are retained.
Property managers retain Commission rules for their assigned properties.
No database cleanup, reseeding or credential reset is needed for this removal.

## 1. Verify the exact candidate on testing

1. Commit and push the builder-removal changes on `codex/security-release`.
2. Deploy that commit to testing using the established testing procedure.
3. Confirm the package-builder tab is absent, including for global administrators.
4. Verify property-manager Commission rules, catalogue import, bill creation,
   existing package billing, reports, attendance, and authenticator login.
5. Record the tested commit. Do not promote an older release that merely hid the
   builder using the testing environment marker.

## 2. One-time production release setup

The recent testing updates were uploaded through SSH. They are not GitHub Actions
release manifests and cannot be entered directly into the promotion workflow.
Do not run `deploy-testing-current.sh` on production or change its environment guards.

Follow [CI/CD setup](CI-CD.md), sections 4–10, to enroll the existing servers:

- Inspect production disk space, containers, database volume and existing backups.
- Configure the separate Tailscale identities and deployment SSH keys.
- Install the deployment tooling with the production scope on the production server.
- Configure read-only GHCR credentials on the server and the GitHub environment secrets.
- Keep `PRODUCTION_CD_ENABLED=false` until enrollment and testing are complete.
- Verify the installed configuration points to the existing production volume;
  do not select a rehearsal or testing volume.

Enrollment does not deploy the application. Preserve existing secrets, database,
reverse-proxy configuration, ports, and PMS integration settings.

## 3. Publish a promotable, validated release

1. Merge the tested candidate and workflow files into `main` through the repository's
   review process. Resolve against the current remote `main`; do not force-push.
2. Set repository variable `CD_ENABLED=true` once testing enrollment is ready.
3. Wait for **Application checks** on the exact main commit to pass.
4. Wait for **Release to testing** to publish the backend/frontend images to GHCR
   and successfully deploy them to testing.
5. Recheck testing, then record this **Release to testing run ID**. This is a GitHub
   Actions run number, not the commit SHA or an SSH archive release name.

The supplied release workflow builds the Disclaimer module with
`VITE_ENABLE_WATER_SPORTS=false`. If Disclaimer should be available in production,
coordinate the frontend build flag and production backend `ENABLE_WATER_SPORTS`
setting before publishing and testing this candidate. A visible navigation label
alone does not enable the backend. Keep the normal `VITE_DEPLOYMENT_MODE=live` for
independent testing and production login; the legacy `testing` mode is a different
authentication integration.

## 4. Promote to production

After testing acceptance and production enrollment:

1. Set `PRODUCTION_CD_ENABLED=true` in repository variables.
2. Open **GitHub → Actions → Promote tested release to production → Run workflow**.
3. Select **main**.
4. Enter the successful **Release to testing run ID** from step 3.
5. Enter the exact confirmation **DEPLOY PRODUCTION**.
6. Run the workflow and approve the production environment if a reviewer is required.

The workflow promotes the same immutable images that passed testing. The server
worker checks scope and disk space, backs up configuration/data, rehearses migrations
on an isolated clone, verifies account compatibility, takes a final backup during
maintenance, applies migrations and recreates the application services. Expect a
brief maintenance interruption. It does not replace production data with testing data.

## 5. Verify and retain recovery information

Confirm the workflow succeeds and check:

```sh
curl --fail --silent --show-error https://diving.ssrsys.com/api/ready
```

Expected response: `{"status":"ready"}`. Then verify real login, the Disclaimer
setting chosen above, a normal billing workflow, reports and manager commission
rules. Confirm the builder is absent. Do not create fictitious production bills
just to test a deployment.

On production, inspect the release without printing secrets:

```sh
sudo cat /var/lib/dive-cd/production/current.json
sudo systemctl list-units --all 'dive-cd-*'
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Keep the recorded release manifest, previous images and private backup directory.
After adopting the pipeline, service-management commands must include its active
override; see [CI/CD operations](CI-CD.md#14-what-changes-on-a-server-during-deployment).

If SSH disconnects, inspect the existing worker before retrying. Do not start a
second deployment. The worker can recover failures before reopening the site;
after the new site starts serving writes, it deliberately does not restore an old
database automatically. Investigate and choose a compatible rollback or forward fix.
Never use `docker compose down --volumes`, database reset/seed commands or global
Docker pruning as deployment or recovery steps.

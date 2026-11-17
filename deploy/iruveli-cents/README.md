# Iruveli commission cents: schema-free production backport

This branch is based on production source commit
`608a10c0c8011b0933eeb603c26ddfd89f8e170b`. It is separate from newer development
work requiring property capability columns and trip tables. Do not deploy `main`
as a substitute for this backport.

## Scope

- Integer cents, decimal half-up earning boundaries, ascending staff-ID remainder
  allocation for tips, daily course/dive pools and leader overrides.
- Personal entitlements rounded per line, role and recipient; multiple instructors
  and photographers still receive the full saved rate individually.
- Existing production percentage and eligibility rules retained, including the
  additional 10% override on the combined course and dive pools.
- One explicit Iruveli property ID, selected from the production property list.
- First effective business date is the actual deployment date in Maldives time.
  Prior dates and payroll locked before that boundary retain the legacy calculation.
  Mixed periods retain the original rounded historical portion.
- Existing report formats and frontend retained. Updated payroll results feed
  existing API, CSV/Excel and PDF consumers; unallocated balances are added to
  breakdown responses and monthly/weekly PDF and Excel reports.
- No schema or dependency changes, npm installations, database migrations,
  fixture writes, database restores or recalculation jobs.

## Delivery

The checked-in `runtime/` files are compiled from the changed TypeScript sources.
`manifest.json` records their hashes and the exact schema, package and compiled
module hashes expected from the running production image. The installer refuses
a different running backend/frontend image or source baseline before stopping
services. Stop if a check fails; do not remove the guard or run migrations.

The Dockerfile layers only these compiled files onto the existing backend image.
It overrides the entrypoint to run the API directly, bypassing automatic migrations.
The application continues to read its original secret-file settings. The frontend,
database image, database volume, ports, network, secrets and base Compose files
are unchanged.

## Run on production

Clone this branch into a separate directory, rather than the live application
directory. For an existing clean checkout of this release branch use
`git pull --ff-only`. Wait for Application checks for the exact release commit
before deployment. A passing local test does not establish Docker or server success.

```bash
git clone --single-branch --branch codex/iruveli-cents-production-20261117 https://github.com/masyyhh/dive_center.git "$HOME/dive-iruveli-cents-release"
cd "$HOME/dive-iruveli-cents-release"
sudo python3 deploy/iruveli-cents/deploy.py check
sudo python3 deploy/iruveli-cents/deploy.py deploy
```

The deploy command lists active property IDs and asks for the Iruveli ID. It
rejects IDs whose property name is not identifiable as Iruveli. It creates and
validates a read-only PostgreSQL backup, checks candidate configuration, builds
the small backend layer using the installed base image with networking disabled,
and runs a database-free smoke test inside the candidate image.

Expect a brief interruption while only this application's web/API containers
restart. Health verification precedes reopening web traffic. The script verifies
public `/api/ready` and saves the active settings in
`/srv/dive-centre-prod/compose.iruveli-cents.json`. Other applications are untouched.

## Subsequent maintenance

Always include the new override after the existing Compose files:

```bash
sudo docker compose --project-directory /srv/dive-centre-prod -p dive-centre-prod --env-file /dev/null -f /srv/dive-centre-prod/compose.migration.yaml -f /srv/dive-centre-prod/compose.app.yaml -f /srv/dive-centre-prod/compose.iruveli-cents.json ps
```

Omitting the override would revert the patch and restore the old migration-enabled
entrypoint. Keep the rollout property ID and effective date unchanged for this
release; changing them changes which dates use the new calculation.

## Rollback

The script prints the exact rollback command and backup directory. A failed
startup automatically attempts application-image rollback. There is no automatic
database restore. To roll back after acceptance testing, use the printed command:

```bash
sudo python3 deploy/iruveli-cents/deploy.py rollback /srv/dive-centre-prod/backups/iruveli-cents-TIMESTAMP
```

The rollback also bypasses migrations. It refuses an unrelated records directory,
a changed base Compose configuration or an unexpected running release. If SSH
disconnects during cutover, inspect the containers, printed records directory and
`COMPLETE` marker before retrying. Do not start a second deployment.

## Validation

Focused backend/report tests and strict TypeScript compilation passed locally.
Deployment guard tests passed, and compiled-payload smoke passed without a DB.
Production Docker execution and public health are verified by the operator's
deployment script, not claimed from this disconnected workstation.

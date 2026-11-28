# Catalogue and Photo commission release — 28 November 2026

This candidate is based on `codex/iruveli-trips-production` at
`d98345bf9446a22cae46c598d82ad8b7b16d6815`. It excludes the unrelated
organization CI/CD and application refactors in the development workspace.
The current live revision could not be checked because production SSH rejected
this workstation's key. The release helper verifies the existing production
stack, creates backups, rehearses migrations against an isolated restored
production database, and verifies original table values before deployment.
It stops if the production configuration does not match its guarded layout.

## Changes

- Photo commission is one discounted pool divided equally among the selected
  Photo staff. Four photos at $4.50 pay two people $9 each. Remainder cents are
  assigned deterministically by staff ID so allocations add up to the pool.
- Property managers can enable **Separate line for each unit** in the catalogue.
  New units become independent quantity-one lines with editable names and prices.
  The rule and edited details are saved with the bill. Existing saved bills retain
  their original line rule. CSV and Excel catalogue transfers include the setting.
- Install with the `2026-11-01` argument below to enable Trips & Tanks in the
  frontend and backend and set `TRIPS_START_DATE=2026-11-01`. The existing backend
  applies that date to trip entry validation and approved trip commission inclusion.
  Entries before 1 November remain disallowed. Existing payroll month locks still
  apply. Normal trip saves use the existing Tanks ÷ assigned staff commission.
  Legacy rule approvals continue to honor each rule's own effective dates; this
  release does not silently backdate existing rule records.

Relative to the Trips production branch, the only new SQL migration adds `separateLinePerUnit` with default `false` to
`Item` and `BillItem`. It does not delete, rename, or replace existing records.
Existing secrets, PMS configuration, database volume, and reverse proxy are
preserved. The established manual installer keeps Disclaimer and Equipment
rentals disabled, as in the existing production release procedure.

## Run on production

Use the pushed branch `codex/catalogue-photo-production-20261128`. Pin its exact
commit to the SHA supplied with the release. Do not substitute the uncommitted
development workspace, run seeds, reset the database, or delete Docker volumes.

On your computer:

```sh
ssh user@192.168.135.39
```

Then on production:

```sh
set -e
git clone --branch codex/catalogue-photo-production-20261128 --single-branch \
  https://github.com/masyyhh/dive_center.git "$HOME/dive-catalogue-20261128"
cd "$HOME/dive-catalogue-20261128"
# Verify HEAD matches the exact SHA in the release message before continuing.
git rev-parse HEAD
sudo python3 scripts/install-manual-production.py "$PWD" 2026-11-01
release=$(git rev-parse --short=12 HEAD)
sudo "/usr/local/sbin/dive-production-$release" prepare "$PWD"
```

Preparation builds images, backs up production, restores an isolated clone,
rehearses migrations and checks original data and authenticator compatibility.
It does not change the live schema or replace running application containers.
Only continue after **PRODUCTION PREPARATION PASSED**. If any command fails,
stop and inspect its error; do not continue to the deploy step or bypass guards.
The helper refuses this manual procedure if production is enrolled in CI/CD.

```sh
sudo "/usr/local/sbin/dive-production-$release" deploy
curl --fail --silent --show-error https://diving.ssrsys.com/api/ready
sudo docker exec dive-centre-prod-backend-1 node -e \
  'console.log({TRIPS_ENABLED:process.env.TRIPS_ENABLED,TRIPS_START_DATE:process.env.TRIPS_START_DATE})'
```

Deployment briefly stops the application, takes a final backup, applies bundled
migrations, verifies original data, recreates the application containers and
checks both API readiness and the public frontend revision. The backend values
must be `true` and `2026-11-01`. The helper records backups and recovery details
under `/srv/dive-centre-prod/releases/manual-<release>/cutover`.

If preparation fails, preserve its output and records. If deployment fails,
follow the helper's recovery message; do not reset or restore production blindly.
After the site has accepted writes, an old database must not be restored without
an explicit recovery decision.

## Verification

Enable the per-unit rule on a suitable catalogue item. On an actual bill that
needs to be entered, add three units and give them distinct names and prices.
Save and reopen the bill to verify them. Do not introduce fictitious financial
records merely to smoke-test production. For Trips & Tanks verify that an
unlocked 1 November 2026 date is accepted, 31 October is rejected, and the desired
crew commission is shown before saving a real trip.

## Candidate checks

Validated locally: 347 backend tests (including isolated PostgreSQL save/reopen
checks), 177 frontend tests, five manual-release tooling tests, and both
production builds. Tests ran on the workstation Node runtime; production image
builds use the repository's Node 22 image. The production backup/restore rehearsal
and public readiness checks must run on the server via the commands above.

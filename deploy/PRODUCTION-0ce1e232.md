# Manual production release: 0ce1e232

Application commit: `0ce1e2329192e0b31d2d8613de1794f69b0c3dea`.
The application passed 267 backend tests, 87 frontend tests, both builds, and
functional testing on the standalone testing site before this release helper.
Helper-only commits do not change the pinned application source.

This release includes manager bill corrections, discount-adjusted commissions,
quantity-specific discounts, full-rate credits for multiple instructors and Photo
staff (including Include Photo), and property-manager roster editing.
The production database and secrets are retained. Fictional guest mode and live
account testing integration are explicitly disabled. The existing production
Disclaimer feature flag determines the frontend build; it is not enabled by this
helper unless already enabled in production.

Install `scripts/release-production-0ce1e232.sh` as root-owned mode 700 at
`/usr/local/sbin/dive-production-0ce1e232`. Install the checksum-matched
`scripts/production-data-fingerprint.cjs` as root-owned mode 444 at
`/usr/local/lib/dive-production-0ce1e232/fingerprint.cjs`.

## Prepare

Run the helper's `prepare /absolute/source/checkout` phase in a persistent
systemd service. The checkout must be clean under backend/frontend and at the
exact application commit. Preparation requires 8 GiB free and refuses an active
production CI/CD override. It validates host/project/volume/secret mount scope,
builds production images, preserves rollback image tags, validates the candidate
Compose configuration, and takes a private online backup.

The helper restores that backup to a uniquely named temporary database, migrates
it, and compares counts and SHA-256 fingerprints of every original column in
every business table. New instructor/Photo credit relations must contain each
historical recipient. Authenticator bindings must still decrypt. The temporary
database is removed. A READY marker is written only after all checks pass.
Preparation leaves production web/backend services running.

## Resume a permission failure before cutover

If preparation built both images and completed its backup but failed with EACCES
reading /app/tools/prisma.cjs, install the updated helper and run its
`resume /absolute/source/checkout` phase. Do not delete the preparation directory
or alter the pinned application checkout.

Resume refuses READY/STARTED/COMPLETE markers, and checks the original running
images, feature flag, configuration, secrets and backup checksums. It requires
2 GiB free because it reuses existing images rather than rebuilding dependencies.
Small repair layers give the backend node user ownership of tooling/package
metadata and make public frontend files readable. The backend remains non-root.
Both filesystem access and Prisma CLI startup are tested without a database.
Original and repaired image IDs and Dockerfiles are retained in the release records.
A new rehearsal backup and timestamped before/after fingerprints are created;
previous backups and failed rehearsal records are preserved. The application
code stays pinned to the tested 0ce1e232 commit. Future Docker builds also apply
the corrected runtime ownership and public-asset permissions directly.

Wait for PRODUCTION PREPARATION PASSED before running deploy.

## Deploy

Only after `PRODUCTION PREPARATION PASSED`, run the helper's `deploy` phase in a
new persistent systemd service. It verifies the prepared image IDs and unchanged
configuration, secrets, existing images and feature flag. Both application
services stop briefly for a final backup and before/after live-data verification.
The database container and its volume remain in place. The original Compose
file is replaced atomically with the validated candidate. The backend must be
ready before the web service opens.

Public HTTPS /api/ready must return ready through the trusted reverse proxy.
The public index.html must match the built production frontend. The helper does
not probe the direct web IP, which production deliberately rejects.

Release records: `/srv/dive-centre-prod/releases/manual-0ce1e232`.
Final recovery backup and comparison records: its `cutover` subdirectory.
These are root-private records; configuration archives contain secrets.

## Failure behavior

Do not rerun a helper after an unknown or failed cutover. Inspect its journal and
STARTED/COMPLETE markers first. A failure before migrations restarts the old
application. Failure during migrations or pre-opening verification leaves the
application offline for reviewed recovery. After attempting to open the new web
service, requests may have written data: no automatic database restore occurs.
The helper never deletes the production database, prunes volumes, resets users,
seeds data or copies the testing database into production.

After success, verify normal sign-in and the manager bill/staff editors and
instructor/Photo selectors in the live browser. Avoid creating fictional bills
or changing production staff solely as a deployment check. Preserve recovery
backups until the release is accepted.

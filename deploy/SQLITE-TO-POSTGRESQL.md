# Migrate existing SQLite data

The application now uses PostgreSQL exclusively. The importer opens SQLite read-only, validates its integrity and relationships, and copies all 13 application tables in one PostgreSQL transaction. It preserves IDs, usernames, password hashes, encrypted authenticators, recovery-code hashes, history, dates and amounts. It reads every imported row back and compares every scalar field before committing. A failed import rolls back, and a nonempty target is rejected.

## Before import

1. Stop all writers to the SQLite database and take a consistent backup using SQLite's backup API. Retain the old application revision, schema, migrations and private encryption/signing configuration for rollback. Do not copy only the main file while SQLite has active WAL writes.
2. The snapshot must have the final SQLite schema: usernames, optional emails, authenticator tables, PMS mappings and property deletion timestamps. An older schema must be upgraded using the matching old application first. The importer refuses missing tables or columns.
3. Create a fresh PostgreSQL database, then run the new PostgreSQL `npm run migrate:deploy`. Do not run administrator bootstrap before import and do not mark SQLite migrations as applied on PostgreSQL.
4. Preserve the original `AUTHENTICATOR_ENCRYPTION_KEY`. Rehearse the import and account/report checks in an isolated PostgreSQL database before the final cutover.

## Local import

Requires Node.js 22.13+ (or 24 LTS) for the built-in SQLite reader. Configure the target PostgreSQL `DATABASE_URL` privately in `backend/.env.local` or the process environment, then run from the repository root:

```sh
npm run migrate:deploy --prefix backend
npm run import:sqlite --prefix backend -- /absolute/path/to/snapshot.db
```

The command reports verified row counts without exposing credentials or personal data. There is no overwrite option. Use a separate empty database for another rehearsal.

## Docker import

Preserve the original authenticator key as `secrets/authenticator_key` before running preparation. Keep the secret directory private and files readable by the container user, as with generated secrets. Configure the deployment and start/migrate PostgreSQL using the production runbook, but skip bootstrap. While the web/API services remain stopped, import a consistent snapshot through a read-only bind mount:

```sh
docker compose --env-file .env.production run --rm -v /absolute/path/to/snapshot.db:/import/source.db:ro backend npm run import:sqlite -- /import/source.db
```

Verify the importer totals, account access, authenticator enrollment/recovery, payroll totals, reports and archived-property behavior. Then start the services and check `/api/ready`. Preserve old SQLite backups offline; the importer does not modify or delete them. Retired email reset challenges are not a supported recovery path.

If cutover fails before users write PostgreSQL data, return to the archived SQLite application/configuration and untouched snapshot. After PostgreSQL accepts new writes, reverting requires reconciliation; never silently switch users back to the stale SQLite copy.

## This workspace's cutover

A source archive and consistent SQLite backup were created under ignored `backups/` before changes. The old schema and migrations are retained there. The local dataset was rehearsed in an isolated PostgreSQL schema, then imported into the local application database with every row verified. Production deployment remains a separate operation.

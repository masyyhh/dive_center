# Dive Centre Manager

Multi-property dive-centre billing, attendance, commissions and monthly reports. The application uses a React/Vite frontend, an Express/TypeScript API, Prisma and **PostgreSQL 18**.

## Local development

Use Node.js 22.13+ (22 or 24 LTS), npm and PostgreSQL 18 tools on PATH. Run from the repository root:

```sh
npm ci --prefix backend
npm ci --prefix frontend
node scripts/setup-local-secrets.cjs
node scripts/setup-authenticator-key.cjs
node scripts/local-postgres.cjs start
npm run migrate:deploy --prefix backend
npm run dev --prefix backend
```

In another terminal:

```sh
npm run dev --prefix frontend
```

The API listens on `127.0.0.1:5001`; Vite serves `http://localhost:5173` and proxies API requests. The local database helper creates private app/test connection URLs in `backend/.env.local`, stores the PostgreSQL cluster under `.local/`, and listens only on `127.0.0.1:55432`. Use `node scripts/local-postgres.cjs status` or `stop` to manage it. Stop retains data. PostgreSQL does not start automatically after reboot; run `start` again. `PG_BINDIR` can select the PostgreSQL tools; `LOCAL_POSTGRES_PORT` selects another port.

For an independently managed PostgreSQL server, configure `DATABASE_URL` in the process environment or private `backend/.env.local`. `backend/.env.example` documents other settings. Environment variables take precedence over local files. Production can supply `DATABASE_URL_FILE` instead; set only one form. Never commit connection passwords or encryption keys.

A fresh database has no demo accounts. Build the backend and run `npm run bootstrap:admin --prefix backend` with private `ADMIN_EMAIL`, `ADMIN_NAME` and `ADMIN_PASSWORD_FILE` environment settings to create its first administrator. Bootstrap refuses to replace an existing administrator. Imported databases keep their existing accounts and password hashes.

## Accounts and properties

- Accounts use unique usernames; contact email is optional and may be shared. Each user binds their own authenticator and saves private one-time recovery codes. Password recovery does not send email.
- Global administrators can edit usernames, names, contact emails, roles, active status and property assignments in Administration → Users. Delete user requires the username for confirmation, revokes access, and retains billing, staff, payroll and audit history; deleted usernames remain reserved. Administrators cannot delete, disable or demote their own account.
- Administrators create property managers; managers create staff accounts within their assigned properties. Provisioned accounts must change their initial password before enrolling an authenticator and entering the workspace. The current password-change policy requires at least 12 characters, including uppercase, lowercase, a number and a symbol, without spaces.
- Property managers and global administrators can add custom staff role titles under Administration → Staff → Add role title. Titles are saved per property and appear in the Add Staff dropdown alongside standard and existing titles. Titles use 2–100 characters; duplicate names ignore case and repeated spaces. Pool-sharing and base-leader settings remain configurable per staff member. Apply the staff-role-titles migration before serving this version (`npm run migrate:deploy --prefix backend`).
- Certifications is a standard activity category, added to existing retained properties that have not been removed and included for newly created properties. The Certifications Pool tracks each activity's pool contribution multiplied by billed quantity, separately from staff payroll. It pays no staff pool share or base-leader override. Its total appears in Reports and daily/monthly Excel exports. Numeric catalogue-import commissions for Certifications use `CERTIFICATION_POOL`; personal commission settings remain separate. Existing activities and their historical pool rules are preserved. Apply migrations before serving this version.
- Course and dive pools use percentage rates, defaulting to 10% of the saved service total after discounts and before tax/service charge. The percentage-pools migration sets existing course/dive catalogue rates to 10%, recalculates existing bill-line contributions in unlocked months, and freezes locked-month contributions at their previous fixed amounts. Saved pool amounts remain stable after catalogue edits. Certifications contributions remain fixed amounts per unit. For newly created or explicitly edited bills, personal commissions (including Photo) are reduced by their own line discount and any compounded checkout discount. Historical bills retain their saved commission factor. Apply this migration before serving the updated API.
- The activity editor’s **Calculator preview** button opens a **Try a bill** calculator that previews quantity, discount, the course/dive percentage pool, and fixed employee payments separately. Its complimentary-service example reduces the activity pool and personal payments to zero; an added Photo retains its payment until that Photo line is also discounted. Preview quantity/discount do not change the activity.
- Property managers and global administrators can edit active posted bills within their assigned properties using Bills → View → Edit bill. Both original and target payroll months must be open. Corrections require a reason and a current bill version; the before/after bill is saved atomically in the audit log. Saved commission/pool and tax rates are retained for existing lines.
- Bill lines support multiple instructors and multiple Photo staff, including automatic Photo lines from Include Photo. Each selected person receives the full saved catalogue rate for their role per unit × quantity × the after-discount factor; it is not split between recipients. All selections must be unique, from the same property and eligible on the business date. Historical single-instructor bills retain their recipient and payout.
- Property managers can edit staff within their assigned property under Administration → Staff & Pools → Edit staff, including names, email, role titles, employment dates, pool participation and active status. Inactive staff remain available in that management roster for reactivation; bill credit lists include eligible active staff only. Staff edits reject changes to property assignments or login permissions and record before/after values in the audit log.
- Use **Discount only some units** on a bill line to separate discounted units from remaining units. Linked Photo quantities and staff assignments are preserved. Adding the activity again does not merge new units into a discounted line.
- Catalogue search combines name/code, category, pool and photo/video filters. Select up to 200 active services to enable or disable automatic Photo lines; review the current and proposed settings before saving. Changes apply together, and a changed service requires a fresh review. Existing bills retain their saved payment rules.
- In Reports → Staff commissions, **Why this amount?** traces each employee’s pool shares, fixed payments, tips and base-leader override to the originating bill and service. Calculations show eligible-recipient counts and any rounding adjustment needed to reconcile the displayed entries to payroll.
- Choose **No commissions for this activity** for services that earn no pool or employee payments. This keeps the guest price and normal charges while saving No pool, no employee rates and no automatic Photo line. Protected billed pool rules still require a new activity. In spreadsheets, use `No pool`, leave all employee payment columns blank, and set Include Photo ($41.975) to `No`.
- Activity employee payments use role checkboxes and labelled amounts per service unit, with a live payment preview. Managers can configure Seller, Guide / Divemaster, Instructor, Photographer and Videographer payments without entering role codes or JSON. The automatic Photo setting shows the added $41.975 charge and fixed $4.50 employee payment, and retains separate media settings for later use.
- In Administration → Catalogue, managers and administrators can tick **Include Photo ($41.975)**. Selecting that activity on a new bill adds a linked **Photo** line at **$41.975 per unit on top of the activity price**. Select one team member on the Photo line to earn **$4.50 per unit**; leaving it unassigned pays no Photo commission. The parent activity retains other roles and contributes to its own pool, but pays no separate photo/video commission. Photo quantity follows the activity; removing the activity removes its Photo. The activity discount does not discount the Photo automatically; its discount can be adjusted separately. Normal property tax and service charge apply. Existing saved bills keep their original prices and bundled commission snapshots. Old drafts are converted and reviewed before saving. Apply the additive automatic-photo-lines migration before serving this version.
- Global administrators create properties, edit their details through Administration → Properties → Edit property, and remove them from the workspace. Editing supports the name, unique code, location, currency, tax and service charge rates, next check number, active status and PMS resorts. Removal retains bills, staff, payroll and audit history, revokes assignments, and reserves the property code.
- Property managers manage bill activities through Administration → Catalogue for their assigned properties. They can add activities, edit prices and details, delete activities from new bills and restore them. Each property's codes and prices are independent. Use a separate activity code for a promotional offer and delete it when it ends; promotions are managed manually. Saved bill prices remain unchanged. Pool rules on billed activities are fixed to preserve historical payroll, so create a new activity for different pool rules. Centre staff can read active activities but cannot manage the catalogue; global administrators retain access across properties.
- Room lookup uses the server-only PMS key and each property's PMS resort mapping, which only global administrators can change. Users choose the correct guest when a room has multiple occupants before applying guest details.

Keep `AUTHENTICATOR_ENCRYPTION_KEY` stable and backed up with the database; replacing it makes existing authenticator bindings unreadable. Login accounts and staff roster entries are separate resources.

Authenticator enrollment supports recovery and gates workspace access; normal sign-in does not require an OTP challenge. It is not enforced MFA on every login.

Global administrators can open **Customize catalogue** or **Customize commission rules** on each card in Administration → Properties. The Commission rules screen lists that property’s activity pool rates and employee payments, with direct editing and a **New activity with these rules** option for changing protected pool rules. Use **Customize property** to switch centres, and **Configure staff pool sharing** to manage eligible staff. Existing saved bill commissions remain unchanged.

Global administrators land on **All properties overview**, with a date range of up to 366 days, property search, currency filters and comparison sorting. Revenue is active-bill gross sales less discounts, before service charge, tax and tips; commissions reuse the property payroll calculation, including tips. Totals stay grouped by currency with no conversion. Missing attendance counts unrecorded entries for employed, active dive staff on past dates, including partial days, excluding today and future dates. Inactive properties remain visible; removed properties are excluded. Select a financial figure to open that property's bills or payroll for the selected period; discounts open discounted active bills, and missing attendance opens the first incomplete date. Select a property name for its daily overview. The cross-property API is restricted to global administrators; managers and centre staff retain their existing overview. No database migration is required.

## Verification

Keyboard navigation uses Alt + Shift (Option + Shift on Mac) plus 1 for Overview, 2 for New bill, 3 for Bills, 4 for Attendance, 5 for Reports & payroll, 6 for Administration (managers/admins), and 7 for Dive centre (when enabled). Alt + Shift + K or the keyboard button in the top bar opens the shortcut guide. Shortcuts pause in form fields, editable content, dialogs and mobile navigation. Page changes retain the existing unsaved-work warnings.

Start PostgreSQL before running backend tests. `TEST_DATABASE_URL` must point to a separate database with a name ending in `_test`. Each database integration suite creates and removes its own random schema; tests refuse the application database.

```sh
node --test tests/*.test.cjs
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix backend
npm run build --prefix frontend
```

CI runs tests against PostgreSQL 18, builds both production images and exercises a disposable Compose installation, including backup/restore checks. Require a successful run for the exact release commit. Build outputs and dependencies are ignored by Git; lockfiles pin npm dependencies, while base images should be pinned by reviewed digest for reproducible releases. Tests remain in source control but are excluded from production images.

## Production and existing data

For the independent testing and production servers, follow the [testing-first CI/CD setup and operations guide](deploy/CI-CD.md). It covers GitHub Actions, GHCR, private deployment connectivity, server enrollment, testing releases and explicit production promotion.

Use the [production runbook](deploy/PRODUCTION.md) for Docker Compose, HTTPS, secrets, backups and restores. Use the [SQLite migration guide](deploy/SQLITE-TO-POSTGRESQL.md) for an existing installation. PostgreSQL has its own migration history; SQLite migrations must not be replayed against it.

For a trial alongside the current release at the same URL, use [parallel testing](deploy/PARALLEL-TESTING.md). It freezes the running live images and provides an isolated testing stack at `/?version=testing`, with separate sessions/data and a return-to-live banner.


Private backups, reference materials and the previous SQLite schema are retained under ignored `backups/`. Local databases, credentials, reference PDFs, development dependencies and build outputs are excluded from production build contexts. Production uses compiled backend code with runtime dependencies and a static frontend served by Caddy.

Catalogue managers can download Excel/CSV files or templates and review imports in Administration → Catalogue. Exports now use labelled columns: `Item Code`, `Service Name`, `Category`, `Price`, `Pool`, `Pool Rate (%)`, `Certifications Amount / Unit`, five employee payment columns (Seller, Guide, Instructor, Photographer, Videographer), `Include Photo ($41.975)`, and `Status`. Enter `10` for a 10% course/dive pool rate. Certifications use a fixed amount per unit; employee payments are fixed amounts per unit. Blank employee payment cells disable that role; explicit `0` retains a role with no payment. Photo `Yes` adds a separate $41.975 Photo line per unit to new bills and pays its selected team member $4.50 per unit; separate photographer/video rates are paused. `No` uses those separate rates; blank retains an existing checkbox setting. Excel templates include dropdowns, notes and an Instructions sheet. Existing six-column catalogue files and the previous 14-column photo/video header remain importable.

Imports validate every row before writing, then show new/update counts and readable pool/payment settings for review. Existing codes update this property's matching services; new codes are retained, and blank codes receive generated property-local codes such as `DIV-001`. Up to 2,000 activities / 3 MB are supported. Saved bill prices and protected pool rules remain unchanged.

Room and villa identifiers must contain 1–32 digits. They remain strings so leading zeros such as `0012` are preserved in bills, PMS lookups and guest forms. Existing historical records are retained. Numeric API fields require JSON numbers, flags require JSON booleans, and database integer fields reject fractions and values above 2,147,483,647. Staff edits validate calendar dates and preserve omitted settings. Catalogue, commission rules and calculators display the selected property's Photo price and employee payment; unit prices retain up to three decimal places.

Global administrators can assign multiple PMS resorts to a property. Room lookup searches every assigned resort and combines guest matches with their resort shown; a failure in any resort returns an error instead of an incomplete result. Existing single-resort mappings are retained by the database migration. Staff creation accepts an empty leaving date and optionally creates a linked centre-staff login, assigned only to that property, for either global administrators or property managers.


## Security update deployment notes

Apply the included additive migrations before running the updated API (`npm run migrate:deploy --prefix backend`); the production entrypoint also migrates before serving. The `RevokedToken` table stores keyed token digests and expiry times, never raw bearer tokens. Deploy the updated authentication code on every API instance before relying on logout revocation. Existing tokens remain compatible; newly issued tokens have unique session identifiers. Logout revokes the presented session, including when the account is locked; network/persistence failures remain visible and can be retried. Expired digest rows are cleaned during successful sign-out. No key or password rotation is required by these changes.

API clients must send uncompressed JSON/form bodies. The 5 MB request limit and 2,000-row catalogue-import capacity are retained. Before schema parsing, requests are limited to 10,000 values, 20 nesting levels and 2,000 entries per container. Domain limits are 200 bill lines, 1,000 attendance records, tip recipients or property assignments, and 7 PMS resorts. Attendance notes are limited to 2,000 characters; validation responses contain at most 20 issues. Catalogue uploads use a bounded base64 string and remain supported within the original size limits.

The backend uses patched Zod 4.6.7 and body-parser 1.20.9. Zod migration compatibility keeps omitted update fields unchanged and permits partial personal-commission rate maps. Run the full backend/frontend tests and builds on supported Node 22/24 before releasing. Login lockout is serialized per account, and account-manager password resets recheck live actor credentials, session, roles and assignments together with target ownership inside a transaction.

Production uses an external HTTPS reverse proxy. Node port 5001 and frontend
HTTP port 8080 bind to loopback by default; configure the private bind address,
actual trusted proxy source and firewall before deploying. Caddy certificate
issuance is disabled. See [proxy deployment](deploy/REVERSE-PROXY.md).

If Nginx Proxy Manager is managed by someone else and already forwards the
whole site to 8080, use [proxy relay mode](deploy/PROXY-RELAY.md).

## Dive centre guest forms

The Dive centre module replaces the Water sports navigation and includes a mobile
three-step guest journey: confirm identity from PMS, read a published agreement in
a selected language, and review/sign. Guardians sign for participants under 18.
The page shows link expiry guidance, preserves a signature after a failed save,
and confirms the signed record reference. Agreement languages are configurable;
the surrounding interface currently remains English.

Employees can see today’s signed forms, total records and active guest links.
A preparation checklist checks the villa, PMS property mapping, available
agreement languages and required equipment details. Active links refresh every
30 seconds and can be cancelled. Signed records remain searchable by villa and
can be printed/saved as PDF. A pending list shows up to 20 recent active links.

Diving participation uses its own `DIVING` document category. A property manager
or global administrator must publish the centre’s approved text in **Dive centre
→ Disclaimer languages → Diving participation** before preparing diving forms.
Legacy water sports wording is not substituted for a diving agreement. Existing
snorkeling, gear rental and aid gear forms and their documents remain available.
Signed records keep their original document snapshot, hash and signature.

The module remains off by default in production. Enable the backend with
`ENABLE_DIVE_CENTRE=true` and the frontend build with
`VITE_ENABLE_DIVE_CENTRE=true`. Existing `ENABLE_WATER_SPORTS` and
`VITE_ENABLE_WATER_SPORTS` flags remain fallback aliases; the new flags take
precedence. Both local development entry points enable the module unless explicitly
disabled. The supplied CI/CD release variant currently builds this module disabled;
coordinate a matching enabled build/runtime variant before deploying it.

New links use `#dive-centre-tablet/<capability>` and API routes use `/api/dive-centre`.
Old `#water-sports-tablet` links and `/api/water-sports` routes remain compatible
when the module is enabled. No tables are renamed or records removed. The existing
water sports migration provides storage; no new migration is required for this
module update. Capabilities remain room-scoped, expire after 20 minutes and permit
only one signed record. Guest lookup candidates are cleared after completion.
Use HTTPS and a separate guest device/browser without a staff login.

## Dive package totals

The package builder and package mutation endpoints have been removed. Existing
package records remain available read-only for billing. Their totals use current
catalogue prices multiplied by quantity. No historical package or bill data is removed.
Adding a package to a bill uses those catalogue item prices without an automatic
package discount. Automatic Photo lines, service charges and tax are applied by
the existing billing rules. Previously saved bills retain their recorded amounts.

## Checkout discount

Enter a percentage from 0 to 100 in **New bill → Enter discount (%)**. The
percentage applies once to the remaining item and automatic Photo totals after
line discounts, before service charge and tax; tips are excluded. The server
allocates it across bill lines so saved discounts, percentage commission pools,
reports and exports agree with checkout. Fixed staff payments still follow their
catalogue rates. The percentage is kept in the browser draft, shown at review,
and recorded in the bill creation audit entry. No new database migration is needed.

Catalogue deletion options: normal Delete archives an activity and allows restoration. Under Show deleted activities, Delete permanently removes unused archived activities after typing `DELETE PERMANENTLY`; selected batches are supported up to 200 activities. Items referenced by any saved bill or package cannot be permanently deleted. Each batch either completes entirely or changes nothing, and permanent-deletion audit records are retained.

For the production rollout after package-builder removal, follow [the production release checklist](deploy/PRODUCTION-RELEASE.md). The builder is removed in every environment; existing package data remains read-only for billing.

# Equipment rentals

Equipment rentals adds physical inventory and issue/return tracking to the existing React/TypeScript workspace and Express/Prisma/PostgreSQL API. The sales catalogue remains the source for bill activities; it does not represent physical stock. Rentals reuse property access, active staff, PMS guest lookup, saved disclaimer guests, the existing guest tablet/signature flow, published disclaimer versions, audit logs, tables, and dialogs.

## Enable and release

The module follows the existing Disclaimer feature switch (`ENABLE_DIVE_CENTRE=true` on the API and `VITE_ENABLE_DIVE_CENTRE=true` in the frontend build; existing legacy Water Sports switches remain supported). It is available to assigned properties, not restricted to Siyam World. Managers and global administrators maintain inventory. All authenticated workspace roles may assign and return equipment within their property permissions.

1. Back up the target database and configuration using the existing release procedure.
2. Rehearse all pending migrations on a restored copy. The new additive migration is `20261109010000_equipment_rentals`; existing pending migrations in the checkout still need their normal review.
3. Run `npm ci --prefix backend`, `npm ci --prefix frontend`, and `npm run build` in the release build environment. Do not copy private local environment files.
4. With the intended release datasource configured, run `npm run migrate:deploy --prefix backend` before serving the new API/UI. Do not use `prisma db push` or reset for deployment.
5. Start the normal application containers/services. Check readiness and perform a guest signature, assignment, partial return, and full return in testing first.

No deployment or migration against an application, testing-server, or production database is performed by this implementation task. Automated integration tests use a temporary isolated test database/schema.

## Operating flow

1. Open **Equipment rentals → Inventory** and add physical equipment. Use a unique equipment ID for each bulk batch or one entry per unique serial number. Serialised entries must have quantity one. Stock uses a single size and condition per entry. Damaged equipment cannot be assigned.
2. Choose **New assignment**, enter the room number, and find/select an existing guest. PMS details are resolved again on save; staff cannot submit invented guest snapshots. When PMS is unavailable, saved signed disclaimer records for that room remain selectable. Leading zeros in room numbers are preserved.
3. Review the guest details. Expected return defaults to departure when supplied. Arrival is shown as unavailable for a saved disclaimer that did not capture it. The guest ID shown is the existing saved record ID or a PMS booking/name/property reference: the PMS response currently has no separate guest ID field.
4. Add equipment, adjust whole-number quantities, choose a return date and a currently employed staff member, and save the draft. Prices come from inventory, with integer minor units (cents). Drafts do not reserve equipment.
5. Create the private signature link. It expires after 20 minutes. The existing tablet asks the guest to enter their prepared room and review the exact equipment/price/condition/return-date snapshot, responsibility terms, and age/guardian information before signing. Only the selected rental guest is offered, never other room sharers. The token is stored as a hash and remains in the URL fragment.
6. Refresh status after signing, then **Confirm & assign equipment**. Confirmation requires the current version's signature and rechecks stock, property, staff eligibility, and equipment identity/condition inside the same database transaction.
7. Open the rental to record any subset of returned units, with condition and an optional note. Return quantities cannot exceed outstanding quantities. Damaged units are quarantined and never become available automatically. Serialised returns retain their exact return condition. Bulk batches conservatively use the least serviceable returned condition (New → Good → Fair), with damaged units counted separately.
8. Close a fully returned rental. Cancelling a draft closes it and revokes outstanding signature links. History and signed agreements are retained. Issued equipment must be returned before closure.

Additional equipment can be issued to the same guest through another assignment, with its own reference, signature, and return history. An active signed equipment list is immutable. Draft edits replace the draft list, increment its version, revoke pending invitations, and require a new signature; earlier signed versions remain accessible through Disclaimer records and attached agreement records.

## Agreements and audit

Managers publish approved rental agreement wording/translations under **Disclaimer → Languages → Equipment rental agreement**. New invitations pin the latest version per published language and append the rental-specific equipment schedule. English operational responsibility terms are supplied if no English rental wording has been published. Existing signed records do not change when a manager publishes new wording.

The agreement includes responsibility for equipment care, prompt reporting, loss, theft, damage, return timing, documented repair/replacement charges, and guardian signatures. Signed records reuse the existing document hash, ink validation, immutable snapshot, and signature storage. View them from a rental or the existing Disclaimer record/print workflow.

Every inventory change writes an audit log. Draft creation/editing, signature preparation/completion, assignment, returns, and closure write operational history and audit records in the same transaction as the change. No equipment or signed rental history has a hard-delete endpoint.

## Integrity and behavior

- Property row locks serialize stock mutations and confirmations. Concurrent drafts are permitted; only available stock can be issued. Stale confirmation/return/edit versions are rejected.
- Database foreign keys retain property, stock, staff, user, agreement, and event relationships. SQL constraints reject invalid quantities, conditions, sizes, serial quantities, and stored statuses.
- Statuses: Draft, Active, Partially returned, Returned, Overdue, Closed. Overdue is derived on reads when outstanding equipment is past its business return date; the underlying Active/Partially returned state remains intact. No scheduled status job is required.
- Rental amounts are fixed **per assignment**, without automatic daily charges, taxes, refunds, damage charges, payment collection, or bill posting. These remain separate existing billing operations.
- Managers cannot edit stock while it is assigned. After all equipment returns, a manager may record repair/inspection by saving the appropriate condition; saving a serviceable stock entry releases its quarantined units. Inspect the entire batch first.
- Rental list reads are paged (30 per request). Search/status filters clearly apply to loaded rentals; use Load more for older records. Recent operational history is bounded to 100 entries per rental; audit records remain retained.

## Verification

Backend integration tests cover migration application, authentication/property isolation, manager-only inventory maintenance, strict data types, serial uniqueness, available quantities, guest provenance, signature gating, concurrent confirmations, partial and damaged returns, duplicate/stale returns, draft editing, immutable old signatures, expiration/revocation, audit history, closure, and derived overdue state. Frontend workflow tests cover departure defaults, leading zeros, quantity validation, summaries/removal, draft edit payloads, current-version signature gating, and return validation. The responsive preview uses fictional guests and stock; it does not write to the application database.

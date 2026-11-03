# Posted bill corrections and quantity discounts

## Manager corrections

Property managers (assigned properties only) and global administrators can open
an ACTIVE bill under **Bills → View → Edit bill**. Staff cannot edit posted bills.
A correction requires a reason of at least five characters. Both the original
and replacement business-date months must be open for payroll. Rebated/deleted
bills remain read-only. Duplicate live check numbers remain prohibited.

Saving retains the bill ID, original creator and creation date. Totals, taxes,
line commissions and pool amounts are recalculated server-side. Existing lines
retain saved commission/pool rates, included-Photo behavior and charge/tax rates;
new activities use current catalogue rules. Existing checkout discounts are
already included in saved line percentages and are not applied a second time.
The editor uses its own versioned browser draft, separate from a new bill draft.
A concurrent correction returns 409 and requires reloading the current bill.
The full before/after bill and correction reason are written in the same database
transaction. If audit saving fails, the bill correction rolls back.

## Discounts

Each line's direct percentage and any compounded checkout percentage reduce its
personal commissions. Example: a $10 commission per unit, with 3 units and 20%
discount on only 1 unit, pays $10 + $10 + $8 = $28. A 100% line discount pays zero
personal commission on that line. Tips are unaffected. A zero-price catalogue
service with no percentage discount still pays its configured commission.

Use **Discount only some units**, enter quantity and percentage, then **Apply to
selected units**. The selected units and remaining units become separate lines.
Linked Photo quantities, staff credits and historical source references remain
paired. Discounting an activity does not automatically discount its separately
billed Photo; the Photo has its own discount. Checkout discounts apply to both.
An unfinished selected-unit discount must be applied or cancelled before review.

Course/dive pool contributions remain percentages of discounted line totals.
Certifications contributions remain fixed per unit and are not staff pay.
The additive migration defaults historical personal commission factors to 1;
existing bills and locked payroll are not bulk recalculated. Explicitly editing
an unlocked historical bill applies the new discount rule, disclosed in the editor.

Instructor selection and payment entry remain unchanged in this release, pending
the user's decision on individual instructor amounts per unit versus per line.

## Validation and testing

The migration `20261104000000_posted_bill_edits_and_discount_commission` adds
rate snapshots and a saved personal-commission discount factor. Apply migrations
before starting this version. Do not drop columns or restore a pre-release dump
after the updated site has accepted writes.

On isolated testing:

1. Create a three-unit activity bill and discount only one unit by 20%.
2. Verify separate 2-unit full-price and 1-unit discounted lines and commission totals.
3. Repeat with an automatic Photo, discounting activity and Photo separately.
4. As a property manager, open the bill, edit guest/quantity/discount and provide a reason.
5. Verify bill identity, totals, payroll detail and the BILL_EDIT audit entry.
6. Open one bill in two tabs; after saving the first, the second must reject stale saving.
7. Confirm staff do not see Edit bill and cannot call PUT /api/bills/:id.
8. Confirm a locked original or target payroll month blocks corrections.
9. Confirm historical, unedited bills retain their pre-release personal commission amounts.

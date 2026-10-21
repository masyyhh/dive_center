-- Live check numbers are unique; soft deletion releases a number.
-- Existing duplicates deliberately make deployment fail instead of deleting records.
CREATE UNIQUE INDEX "Bill_live_check_number_key"
ON "Bill" ("propertyId", "checkNumber")
WHERE "status" IN ('ACTIVE', 'REBATED');

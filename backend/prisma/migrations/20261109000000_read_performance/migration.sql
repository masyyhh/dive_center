-- For busy existing databases, prebuild these named indexes with CREATE INDEX CONCURRENTLY
-- one statement at a time before running migrate deploy. IF NOT EXISTS then skips those builds.
-- Otherwise apply in a maintenance window: regular builds block writes on their tables.
CREATE INDEX IF NOT EXISTS "StaffMember_propertyId_isActive_idx" ON "StaffMember"("propertyId", "isActive");
CREATE INDEX IF NOT EXISTS "DivePackageItem_itemId_idx" ON "DivePackageItem"("itemId");
CREATE INDEX IF NOT EXISTS "Bill_propertyId_businessDate_checkNumber_id_idx" ON "Bill"("propertyId", "businessDate" DESC, "checkNumber" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Bill_propertyId_status_businessDate_idx" ON "Bill"("propertyId", "status", "businessDate");
CREATE INDEX IF NOT EXISTS "Bill_propertyId_roomNumber_businessDate_createdAt_idx" ON "Bill"("propertyId", "roomNumber", "businessDate", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "BillItem_billId_linePosition_idx" ON "BillItem"("billId", "linePosition");
CREATE INDEX IF NOT EXISTS "BillItem_itemId_idx" ON "BillItem"("itemId");
CREATE INDEX IF NOT EXISTS "AuditLog_propertyId_createdAt_id_idx" ON "AuditLog"("propertyId", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "WaterSportsRecord_propertyId_runningNumber_idx" ON "WaterSportsRecord"("propertyId", "runningNumber" DESC);

CREATE TABLE "BillItemInstructor" (
  "billItemId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  CONSTRAINT "BillItemInstructor_pkey" PRIMARY KEY ("billItemId", "staffId"),
  CONSTRAINT "BillItemInstructor_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BillItemInstructor_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BillItemInstructor_staffId_idx" ON "BillItemInstructor"("staffId");
-- Retain each historical recipient and payout without recalculating old bills.
INSERT INTO "BillItemInstructor" ("billItemId", "staffId")
SELECT "id", "instructorStaffId" FROM "BillItem" WHERE "instructorStaffId" IS NOT NULL;

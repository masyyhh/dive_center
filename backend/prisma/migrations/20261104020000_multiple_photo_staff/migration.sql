CREATE TABLE "BillItemPhotoStaff" (
  "billItemId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  CONSTRAINT "BillItemPhotoStaff_pkey" PRIMARY KEY ("billItemId", "staffId"),
  CONSTRAINT "BillItemPhotoStaff_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BillItemPhotoStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BillItemPhotoStaff_staffId_idx" ON "BillItemPhotoStaff"("staffId");
-- Retain each historical recipient and payout without recalculating old bills.
INSERT INTO "BillItemPhotoStaff" ("billItemId", "staffId")
SELECT "id", "photoStaffId" FROM "BillItem" WHERE "photoStaffId" IS NOT NULL;

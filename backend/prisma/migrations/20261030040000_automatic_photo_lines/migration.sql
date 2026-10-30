ALTER TABLE "BillItem" ADD COLUMN "linePosition" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BillItem" ADD COLUMN "autoPhotoForLineId" TEXT;
CREATE UNIQUE INDEX "BillItem_autoPhotoForLineId_key" ON "BillItem"("autoPhotoForLineId");
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_autoPhotoForLineId_fkey"
  FOREIGN KEY ("autoPhotoForLineId") REFERENCES "BillItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

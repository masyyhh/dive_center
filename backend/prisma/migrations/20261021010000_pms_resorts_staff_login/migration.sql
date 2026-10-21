ALTER TABLE "Property" ADD COLUMN "pmsPropertyCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Property" SET "pmsPropertyCodes" = ARRAY["pmsPropertyCode"] WHERE "pmsPropertyCode" IS NOT NULL AND "pmsPropertyCode" <> '';
ALTER TABLE "StaffMember" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

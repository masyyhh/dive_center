ALTER TABLE "BillItem"
ADD COLUMN "storeAttendantRateSnapshot" DOUBLE PRECISION,
ADD COLUMN "storeAttendantPoolAmount" DOUBLE PRECISION;

-- Historical bills deliberately retain NULL snapshots and earn no new allocation.
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_storeAttendantPool_check"
CHECK (("storeAttendantRateSnapshot" IS NULL AND "storeAttendantPoolAmount" IS NULL)
  OR ("storeAttendantRateSnapshot" IS NOT NULL AND "storeAttendantPoolAmount" IS NOT NULL
    AND (("storeAttendantRateSnapshot" = 0 AND "storeAttendantPoolAmount" = 0)
      OR ("storeAttendantRateSnapshot" = 5 AND "storeAttendantPoolAmount" >= 0
        AND "storeAttendantPoolAmount" < 'Infinity'::DOUBLE PRECISION))));

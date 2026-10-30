BEGIN;

ALTER TABLE "BillItem" ADD COLUMN "poolTypeSnapshot" TEXT;
ALTER TABLE "BillItem" ADD COLUMN "poolContributionAmount" DOUBLE PRECISION;

-- Freeze locked-month contributions at their old fixed amounts. Correct open
-- months to 10% of the saved discounted line total, excluding tax/service charge.
WITH contributions AS (
  SELECT line."id", COALESCE(item."poolType", 'NONE') AS "poolType",
    CASE
      WHEN item."poolType" IN ('COURSE_POOL', 'DIVE_POOL') AND NOT EXISTS (
        SELECT 1 FROM "MonthLock" lock
        WHERE lock."propertyId" = bill."propertyId"
          AND lock."yearMonth" = substring(bill."businessDate", 1, 7)
          AND lock."isLocked" = true
      ) THEN GREATEST(line."lineTotal", 0) * 0.10
      WHEN item."poolType" IN ('COURSE_POOL', 'DIVE_POOL', 'CERTIFICATION_POOL')
        AND item."poolContribution" >= 0 AND item."poolContribution" < 'Infinity'::float8
        THEN item."poolContribution" * line."quantity"
      ELSE 0
    END AS amount
  FROM "BillItem" line
  JOIN "Bill" bill ON bill."id" = line."billId"
  LEFT JOIN "Item" item ON item."id" = line."itemId" AND item."propertyId" = bill."propertyId"
)
UPDATE "BillItem" line
SET "poolTypeSnapshot" = contributions."poolType",
    "poolContributionAmount" = contributions.amount
FROM contributions WHERE line."id" = contributions."id";

-- Course and dive catalogue values now represent percentages rather than dollars.
UPDATE "Item" SET "poolContribution" = 10, "updatedAt" = CURRENT_TIMESTAMP
WHERE "poolType" IN ('COURSE_POOL', 'DIVE_POOL');

COMMIT;

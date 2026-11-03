-- Preserve historical personal commissions; discounted rates apply when a bill is created or explicitly edited.
ALTER TABLE "Bill" ADD COLUMN "serviceChargeRateSnapshot" DOUBLE PRECISION,
                   ADD COLUMN "taxRateSnapshot" DOUBLE PRECISION;
ALTER TABLE "BillItem" ADD COLUMN "poolRateSnapshot" DOUBLE PRECISION,
                       ADD COLUMN "commissionDiscountFactor" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_commissionDiscountFactor_range"
  CHECK ("commissionDiscountFactor" >= 0 AND "commissionDiscountFactor" <= 1);

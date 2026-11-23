BEGIN;

-- Keep all existing trip records, payouts, IDs and foreign-key relationships.
-- Prisma models and application field names stay compatible with existing code.
ALTER TABLE "TankSession" RENAME TO "dive_trips";
ALTER TABLE "TankCommissionAllocation" RENAME TO "trip_crew_assignments";

ALTER TABLE "dive_trips" RENAME CONSTRAINT "TankSession_pkey" TO "dive_trips_pkey";
ALTER TABLE "dive_trips" RENAME CONSTRAINT "TankSession_propertyId_fkey" TO "dive_trips_propertyId_fkey";
ALTER INDEX "TankSession_propertyId_businessDate_status_idx" RENAME TO "dive_trips_propertyId_businessDate_status_idx";
ALTER INDEX "TankSession_propertyId_requestId_key" RENAME TO "dive_trips_propertyId_requestId_key";

ALTER TABLE "trip_crew_assignments" RENAME CONSTRAINT "TankCommissionAllocation_pkey" TO "trip_crew_assignments_pkey";
ALTER TABLE "trip_crew_assignments" RENAME CONSTRAINT "TankCommissionAllocation_sessionId_fkey" TO "trip_crew_assignments_sessionId_fkey";
ALTER TABLE "trip_crew_assignments" RENAME CONSTRAINT "TankCommissionAllocation_staffId_fkey" TO "trip_crew_assignments_staffId_fkey";
ALTER INDEX "TankCommissionAllocation_staffId_idx" RENAME TO "trip_crew_assignments_staffId_idx";
ALTER INDEX "TankCommissionAllocation_sessionId_staffId_key" RENAME TO "trip_crew_assignments_sessionId_staffId_key";

COMMIT;

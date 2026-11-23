BEGIN;

-- Retain historical boat names even when an old resource ID cannot be linked.
UPDATE "dive_trips" AS trip SET "boatId" = NULL
WHERE "boatId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "TankResource" AS resource
  WHERE resource."id" = trip."boatId" AND resource."propertyId" = trip."propertyId" AND resource."kind" = 'BOAT'
);
ALTER TABLE "dive_trips" ADD CONSTRAINT "dive_trips_boatId_fkey"
  FOREIGN KEY ("boatId") REFERENCES "TankResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "dive_trip_sites" (
  "sessionId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "dive_trip_sites_pkey" PRIMARY KEY ("sessionId", "siteId"),
  CONSTRAINT "dive_trip_sites_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dive_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dive_trip_sites_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "TankResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dive_trip_sites_sessionId_position_key" ON "dive_trip_sites"("sessionId", "position");
CREATE INDEX "dive_trip_sites_siteId_idx" ON "dive_trip_sites"("siteId");

-- Snapshots continue to preserve the names seen when historical trips were saved.
INSERT INTO "dive_trip_sites" ("sessionId", "siteId", "position")
SELECT trip."id", site.value->>'id', MIN(site.ordinality)::INTEGER - 1
FROM "dive_trips" AS trip
CROSS JOIN LATERAL jsonb_array_elements(trip."diveSitesJson"::jsonb) WITH ORDINALITY AS site(value, ordinality)
JOIN "TankResource" AS resource ON resource."id" = site.value->>'id'
  AND resource."propertyId" = trip."propertyId" AND resource."kind" = 'SITE'
GROUP BY trip."id", site.value->>'id';

COMMIT;

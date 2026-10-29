CREATE TABLE "WaterSportsDocument" (
 "id" TEXT NOT NULL PRIMARY KEY, "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "language" TEXT NOT NULL, "languageName" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WaterSportsDocument_propertyId_kind_language_createdAt_idx" ON "WaterSportsDocument"("propertyId", "kind", "language", "createdAt");
CREATE TABLE "WaterSportsSession" (
 "id" TEXT NOT NULL PRIMARY KEY, "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "formType" TEXT NOT NULL, "roomNumber" TEXT NOT NULL, "staffFields" JSONB NOT NULL, "documents" JSONB NOT NULL,
 "candidates" JSONB NOT NULL DEFAULT '[]', "tokenHash" TEXT NOT NULL UNIQUE, "lookupCount" INTEGER NOT NULL DEFAULT 0,
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "WaterSportsSession_propertyId_createdAt_idx" ON "WaterSportsSession"("propertyId", "createdAt");
CREATE TABLE "WaterSportsRecord" (
 "id" TEXT NOT NULL PRIMARY KEY, "runningNumber" SERIAL NOT NULL UNIQUE,
 "sessionId" TEXT NOT NULL UNIQUE REFERENCES "WaterSportsSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "formType" TEXT NOT NULL, "businessDate" TEXT NOT NULL, "guestName" TEXT NOT NULL, "roomNumber" TEXT NOT NULL,
 "departureDate" TEXT, "confirmationNumber" TEXT, "pmsPropertyCode" TEXT NOT NULL, "staffFields" JSONB NOT NULL,
 "documentSnapshot" JSONB NOT NULL, "documentHash" TEXT NOT NULL, "isMinor" BOOLEAN NOT NULL, "guardianName" TEXT,
 "signature" JSONB NOT NULL, "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WaterSportsRecord_propertyId_businessDate_runningNumber_idx" ON "WaterSportsRecord"("propertyId", "businessDate", "runningNumber");

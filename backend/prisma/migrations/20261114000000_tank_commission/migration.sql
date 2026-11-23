-- CreateTable
CREATE TABLE "TankCommissionSettings" (
    "propertyId" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TankCommissionSettings_pkey" PRIMARY KEY ("propertyId")
);

-- CreateTable
CREATE TABLE "TankResource" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TankResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankCommissionRule" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "boatId" TEXT,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "configJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TankCommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankSession" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "departureTime" TEXT,
    "activityType" TEXT NOT NULL,
    "boatId" TEXT,
    "boatName" TEXT,
    "diveSitesJson" TEXT NOT NULL DEFAULT '[]',
    "tanks" INTEGER NOT NULL DEFAULT 0,
    "passengers" INTEGER NOT NULL DEFAULT 0,
    "dives" INTEGER NOT NULL DEFAULT 0,
    "gearWash" INTEGER NOT NULL DEFAULT 0,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "manualTotalCents" INTEGER,
    "participantsJson" TEXT NOT NULL DEFAULT '[]',
    "ruleId" TEXT,
    "overrideJson" TEXT,
    "overrideReason" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "snapshotJson" TEXT,
    "totalCents" INTEGER,
    "unallocatedCents" INTEGER,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TankSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankCommissionAllocation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "staffRoleTitle" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "TankCommissionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TankResource_propertyId_kind_normalizedName_key" ON "TankResource"("propertyId", "kind", "normalizedName");

-- CreateIndex
CREATE INDEX "TankCommissionRule_propertyId_isActive_idx" ON "TankCommissionRule"("propertyId", "isActive");

-- CreateIndex
CREATE INDEX "TankSession_propertyId_businessDate_status_idx" ON "TankSession"("propertyId", "businessDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TankSession_propertyId_requestId_key" ON "TankSession"("propertyId", "requestId");

-- CreateIndex
CREATE INDEX "TankCommissionAllocation_staffId_idx" ON "TankCommissionAllocation"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "TankCommissionAllocation_sessionId_staffId_key" ON "TankCommissionAllocation"("sessionId", "staffId");

-- AddForeignKey
ALTER TABLE "TankCommissionSettings" ADD CONSTRAINT "TankCommissionSettings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankResource" ADD CONSTRAINT "TankResource_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankCommissionRule" ADD CONSTRAINT "TankCommissionRule_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankSession" ADD CONSTRAINT "TankSession_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankCommissionAllocation" ADD CONSTRAINT "TankCommissionAllocation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TankSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TankCommissionAllocation" ADD CONSTRAINT "TankCommissionAllocation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


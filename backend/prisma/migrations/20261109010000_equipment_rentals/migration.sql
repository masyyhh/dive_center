-- CreateTable
CREATE TABLE "EquipmentStock" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "serialNumber" TEXT,
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "quantity" INTEGER NOT NULL,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRental" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestSnapshot" JSONB NOT NULL,
    "expectedReturnDate" TEXT NOT NULL,
    "assignedStaffId" TEXT NOT NULL,
    "assignedStaffName" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "EquipmentRental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentRentalLine" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "serialNumber" TEXT,
    "condition" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "EquipmentRentalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalAgreement" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalEvent" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentStock_propertyId_isActive_idx" ON "EquipmentStock"("propertyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentStock_propertyId_code_key" ON "EquipmentStock"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentStock_propertyId_serialNumber_key" ON "EquipmentStock"("propertyId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentRental_reference_key" ON "EquipmentRental"("reference");

-- CreateIndex
CREATE INDEX "EquipmentRental_propertyId_createdAt_id_idx" ON "EquipmentRental"("propertyId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "EquipmentRental_propertyId_status_expectedReturnDate_idx" ON "EquipmentRental"("propertyId", "status", "expectedReturnDate");

-- CreateIndex
CREATE INDEX "EquipmentRentalLine_stockId_idx" ON "EquipmentRentalLine"("stockId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentRentalLine_rentalId_stockId_key" ON "EquipmentRentalLine"("rentalId", "stockId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_sessionId_key" ON "RentalAgreement"("sessionId");

-- CreateIndex
CREATE INDEX "RentalAgreement_rentalId_version_idx" ON "RentalAgreement"("rentalId", "version");

-- CreateIndex
CREATE INDEX "RentalEvent_rentalId_createdAt_idx" ON "RentalEvent"("rentalId", "createdAt");

-- AddForeignKey
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRentalLine" ADD CONSTRAINT "EquipmentRentalLine_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "EquipmentRental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentRentalLine" ADD CONSTRAINT "EquipmentRentalLine_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "EquipmentStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "EquipmentRental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaterSportsSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalEvent" ADD CONSTRAINT "RentalEvent_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "EquipmentRental"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Defensive constraints supplement API validation for imports and future writers.
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_quantity_check" CHECK ("quantity" > 0 AND "damagedQuantity" >= 0 AND "damagedQuantity" <= "quantity" AND "priceCents" >= 0 AND ("serialNumber" IS NULL OR "quantity" = 1));
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_condition_check" CHECK ("condition" IN ('NEW', 'GOOD', 'FAIR', 'DAMAGED'));
ALTER TABLE "EquipmentStock" ADD CONSTRAINT "EquipmentStock_size_check" CHECK ("size" IN ('XS', 'S', 'M', 'L', 'XL', 'XXL'));
ALTER TABLE "EquipmentRentalLine" ADD CONSTRAINT "EquipmentRentalLine_quantity_check" CHECK ("quantity" > 0 AND "returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity" AND "priceCents" >= 0);
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'PARTIALLY_RETURNED', 'RETURNED', 'CLOSED'));
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EquipmentRental" ADD CONSTRAINT "EquipmentRental_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RentalEvent" ADD CONSTRAINT "RentalEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

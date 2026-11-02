-- AlterTable Property
ALTER TABLE "Property" ADD COLUMN "autoPhotoPrice" DOUBLE PRECISION NOT NULL DEFAULT 41.975;
ALTER TABLE "Property" ADD COLUMN "autoPhotoCommission" DOUBLE PRECISION NOT NULL DEFAULT 4.5;

-- CreateTable DivePackage
CREATE TABLE "DivePackage" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DivePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable DivePackageItem
CREATE TABLE "DivePackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DivePackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DivePackage_propertyId_code_key" ON "DivePackage"("propertyId", "code");
CREATE UNIQUE INDEX "DivePackageItem_packageId_itemId_key" ON "DivePackageItem"("packageId", "itemId");

-- AddForeignKey
ALTER TABLE "DivePackage" ADD CONSTRAINT "DivePackage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DivePackageItem" ADD CONSTRAINT "DivePackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DivePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DivePackageItem" ADD CONSTRAINT "DivePackageItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffRoleTitle" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffRoleTitle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffRoleTitle_propertyId_normalizedName_key" ON "StaffRoleTitle"("propertyId", "normalizedName");
ALTER TABLE "StaffRoleTitle" ADD CONSTRAINT "StaffRoleTitle_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

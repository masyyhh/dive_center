-- Add the category without changing any existing activity or its commission rules.
INSERT INTO "Category" ("id", "propertyId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", 'Certifications',
       COALESCE((SELECT MAX(c."sortOrder") FROM "Category" c WHERE c."propertyId" = p."id"), 0) + 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Property" p
WHERE p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Category" c
    WHERE c."propertyId" = p."id" AND lower(trim(c."name")) = 'certifications'
  );

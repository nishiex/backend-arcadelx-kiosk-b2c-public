-- Company-created distributors already have a direct parent relationship.
-- Make that relationship active so existing distributors can receive an agreement
-- without a separate connection request. Existing connections are preserved.
INSERT INTO "NetworkConnection" (
  "id", "initiatorOrgId", "receiverOrgId", "status", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  organization."parentOrgId",
  organization."id",
  'ACTIVE'::"NetworkStatus",
  NOW(),
  NOW()
FROM "Organization" AS organization
WHERE organization."type" = 'DISTRIBUTOR'
  AND organization."parentOrgId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "NetworkConnection" AS connection
    WHERE (connection."initiatorOrgId" = organization."parentOrgId" AND connection."receiverOrgId" = organization."id")
       OR (connection."initiatorOrgId" = organization."id" AND connection."receiverOrgId" = organization."parentOrgId")
  );

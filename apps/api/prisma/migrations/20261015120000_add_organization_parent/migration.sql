ALTER TABLE "Organization" ADD COLUMN "parentOrgId" TEXT;

CREATE INDEX "Organization_parentOrgId_idx" ON "Organization"("parentOrgId");

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_parentOrgId_fkey"
  FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

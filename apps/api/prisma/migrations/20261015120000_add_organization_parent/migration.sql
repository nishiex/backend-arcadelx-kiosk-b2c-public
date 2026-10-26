ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "parentOrgId" TEXT;

CREATE INDEX IF NOT EXISTS "Organization_parentOrgId_idx" ON "Organization"("parentOrgId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_parentOrgId_fkey') THEN
    ALTER TABLE "Organization"
      ADD CONSTRAINT "Organization_parentOrgId_fkey"
      FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

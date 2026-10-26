-- Existing organizations retain access. Independent of the lifecycle backfill.
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "accessVersion" INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_accessVersion_nonnegative') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_accessVersion_nonnegative" CHECK ("accessVersion" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_only_distributor_inactive') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_only_distributor_inactive" CHECK (type = 'DISTRIBUTOR' OR "isActive");
  END IF;
END $$;

-- Existing organizations retain access. Independent of the lifecycle backfill.
ALTER TABLE "Organization"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_accessVersion_nonnegative" CHECK ("accessVersion" >= 0),
  ADD CONSTRAINT "Organization_only_distributor_inactive" CHECK (type = 'DISTRIBUTOR' OR "isActive");

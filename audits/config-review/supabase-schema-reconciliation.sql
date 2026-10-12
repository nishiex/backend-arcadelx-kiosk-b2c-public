-- Targeted reconciliation of the Supabase public schema onto this branch's lineage.
--
-- Why this file exists instead of `prisma migrate deploy`:
-- the remote migration history diverged at 20260922151453. Prisma refuses to deploy a
-- history it cannot reconcile, and the remote's own migration names are not in this
-- checkout, so the missing DDL is applied directly here and recorded afterwards.
--
-- Every statement is additive and idempotent:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   * no DROP, no DELETE, no TRUNCATE, no type narrowing of existing data
-- Existing rows are preserved. Defaults backfill the new NOT NULL columns.
--
-- Source migrations on this branch:
--   20261005121000_restore_registration_fields  -> Organization profile/access columns
--   20261005120000_restore_order_workflow       -> Kiosk.reservedOrderId, OrderSequence, EmailDelivery
--
-- Supabase-only objects (NetworkConnection.deletedAt, KioskReturnRequest) are deliberately
-- left untouched: they come from the remote lineage and are additive.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------- Organization
-- Registration writes phone/country; access checks read isActive/accessVersion.
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "gstNumber"     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "phone"         VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "country"       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "isActive"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "accessVersion" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Organization"'::regclass AND conname='Organization_accessVersion_nonnegative') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_accessVersion_nonnegative" CHECK ("accessVersion" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Organization"'::regclass AND conname='Organization_only_distributor_inactive') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_only_distributor_inactive" CHECK (type='DISTRIBUTOR' OR "isActive");
  END IF;
END $$;

-- ---------------------------------------------------------------- Order workflow
ALTER TABLE "Kiosk" ADD COLUMN IF NOT EXISTS "reservedOrderId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Kiosk"'::regclass AND conname='Kiosk_reservedOrderId_fkey') THEN
    ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_reservedOrderId_fkey"
      FOREIGN KEY ("reservedOrderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "KioskAssignment_one_open_key"
  ON "KioskAssignment" ("kioskId") WHERE "assignedTo" IS NULL;

-- Order number counter. The remote has no orders, so nothing to seed from.
CREATE TABLE IF NOT EXISTS "OrderSequence" (
  year  INTEGER PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- Transactional email queue (invoice / credentials / revenue statements).
CREATE TABLE IF NOT EXISTS "EmailDelivery" (
  id                  TEXT PRIMARY KEY,
  key                 TEXT NOT NULL UNIQUE,
  kind                TEXT NOT NULL,
  "ownerOrganizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payload             TEXT NOT NULL,
  attempts            INTEGER NOT NULL DEFAULT 0,
  "leaseId"           TEXT,
  "lockedUntil"       TIMESTAMP(3),
  "sentAt"            TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);

COMMIT;

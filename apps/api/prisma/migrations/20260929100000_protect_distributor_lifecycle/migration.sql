-- Additive migration. Existing ambiguous reservations/duplicate history must be
-- reconciled explicitly before deployment; do not silently delete historical rows.
BEGIN;

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "gstNumber" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "country" VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS "NetworkConnection_pair_key"
  ON "NetworkConnection" (LEAST("initiatorOrgId", "receiverOrgId"), GREATEST("initiatorOrgId", "receiverOrgId"));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'network_distinct_parties') THEN
    ALTER TABLE "NetworkConnection" ADD CONSTRAINT "network_distinct_parties" CHECK ("initiatorOrgId" <> "receiverOrgId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_distinct_parties') THEN
    ALTER TABLE "Agreement" ADD CONSTRAINT "agreement_distinct_parties" CHECK ("parentOrgId" <> "childOrgId");
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "Agreement_open_pair_key" ON "Agreement" ("parentOrgId", "childOrgId")
  WHERE status IN ('PENDING_APPROVAL', 'ACTIVE');
CREATE UNIQUE INDEX IF NOT EXISTS "KioskAssignment_one_open_key" ON "KioskAssignment" ("kioskId") WHERE "assignedTo" IS NULL;

ALTER TABLE "Kiosk" ADD COLUMN IF NOT EXISTS "reservedOrderId" TEXT;
DO $$
BEGIN
  IF EXISTS (
    SELECT o.id FROM "Order" o LEFT JOIN "OrderKiosk" ok ON ok."orderId"=o.id
    WHERE o.status IN ('APPROVED','DISPATCHED') GROUP BY o.id
    HAVING count(ok."kioskId") <> o.quantity OR o.quantity < 1
  ) THEN RAISE EXCEPTION 'Active order kiosk count does not match its quantity; reconcile before migrating'; END IF;
  IF EXISTS (
    SELECT ok."kioskId" FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId"
    WHERE o.status IN ('APPROVED','DISPATCHED') GROUP BY ok."kioskId" HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Multiple active orders reference the same kiosk; reconcile before migrating'; END IF;
END $$;
UPDATE "Kiosk" k SET "reservedOrderId"=o.id
  FROM "OrderKiosk" ok JOIN "Order" o ON o.id=ok."orderId"
  WHERE k.id=ok."kioskId" AND o.status IN ('APPROVED','DISPATCHED');
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Kiosk" k JOIN "Order" o ON o.id=k."reservedOrderId"
    WHERE k."currentOrgId" IS DISTINCT FROM o."parentOrgId"
      OR (o.status='APPROVED' AND k.status<>'RESERVED')
      OR (o.status='DISPATCHED' AND k.status<>'ASSIGNED')
  ) THEN RAISE EXCEPTION 'Kiosk ownership/status conflicts with its active order; reconcile before migrating'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Kiosk_reservedOrderId_fkey') THEN
    ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_reservedOrderId_fkey" FOREIGN KEY ("reservedOrderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kiosk_reservation_state') THEN
    ALTER TABLE "Kiosk" ADD CONSTRAINT "kiosk_reservation_state" CHECK ((status IN ('RESERVED','ASSIGNED')) = ("reservedOrderId" IS NOT NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OrderSequence" (year INTEGER PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
INSERT INTO "OrderSequence" (year, value)
  SELECT split_part("orderNumber",'-',2)::integer, max(split_part("orderNumber",'-',3)::integer)
  FROM "Order" WHERE "orderNumber" ~ '^ORD-[0-9]{4}-[0-9]+$' GROUP BY 1
  ON CONFLICT (year) DO UPDATE SET value = GREATEST("OrderSequence".value, EXCLUDED.value);

CREATE TABLE IF NOT EXISTS "EmailDelivery" (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  "ownerOrganizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, "leaseId" TEXT,
  "lockedUntil" TIMESTAMP(3), "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);

UPDATE "Order" SET "invoiceUrl"='/api/orders/' || id || '/invoice' WHERE "invoiceUrl" LIKE '/orders/%/invoice';
COMMIT;

-- Restore only the order prerequisites removed by a later remote-only revert.
-- Compatible with databases that already retain these additive objects.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE "Order", "OrderKiosk", "Kiosk", "KioskAssignment" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Kiosk" ADD COLUMN IF NOT EXISTS "reservedOrderId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT o.id FROM "Order" o LEFT JOIN "OrderKiosk" ok ON ok."orderId" = o.id
    WHERE o.status IN ('APPROVED', 'DISPATCHED') GROUP BY o.id
    HAVING count(ok."kioskId") <> o.quantity OR o.quantity < 1
  ) THEN RAISE EXCEPTION 'Active order quantity mismatch; reconcile before restoring orders'; END IF;
  IF EXISTS (
    SELECT ok."kioskId" FROM "OrderKiosk" ok JOIN "Order" o ON o.id = ok."orderId"
    WHERE o.status IN ('APPROVED', 'DISPATCHED') GROUP BY ok."kioskId" HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Ambiguous active reservation; reconcile before restoring orders'; END IF;
  IF EXISTS (
    SELECT 1 FROM "OrderKiosk" ok JOIN "Order" o ON o.id = ok."orderId"
    JOIN "Kiosk" k ON k.id = ok."kioskId"
    WHERE o.status IN ('APPROVED', 'DISPATCHED') AND (
      k."currentOrgId" IS DISTINCT FROM o."parentOrgId"
      OR (o.status = 'APPROVED' AND k.status <> 'RESERVED')
      OR (o.status = 'DISPATCHED' AND k.status <> 'ASSIGNED')
      OR (k."reservedOrderId" IS NOT NULL AND k."reservedOrderId" <> o.id)
    )
  ) THEN RAISE EXCEPTION 'Active stock ownership/status/pointer mismatch; reconcile before restoring orders'; END IF;
  IF EXISTS (
    SELECT 1 FROM "Kiosk" k WHERE k."reservedOrderId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "OrderKiosk" ok JOIN "Order" o ON o.id = ok."orderId"
      WHERE ok."kioskId" = k.id AND o.id = k."reservedOrderId" AND o.status IN ('APPROVED', 'DISPATCHED')
    )
  ) THEN RAISE EXCEPTION 'Stale reservation pointer; reconcile before restoring orders'; END IF;
END $$;

UPDATE "Kiosk" k SET "reservedOrderId" = o.id
FROM "OrderKiosk" ok JOIN "Order" o ON o.id = ok."orderId"
WHERE k.id = ok."kioskId" AND o.status IN ('APPROVED', 'DISPATCHED') AND k."reservedOrderId" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Kiosk"'::regclass AND conname = 'Kiosk_reservedOrderId_fkey') THEN
    ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_reservedOrderId_fkey"
      FOREIGN KEY ("reservedOrderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Kiosk"'::regclass AND conname = 'kiosk_reservation_state') THEN
    ALTER TABLE "Kiosk" ADD CONSTRAINT "kiosk_reservation_state"
      CHECK ((status IN ('RESERVED', 'ASSIGNED')) = ("reservedOrderId" IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "KioskAssignment_one_open_key"
  ON "KioskAssignment" ("kioskId") WHERE "assignedTo" IS NULL;

CREATE TABLE IF NOT EXISTS "OrderSequence" (year INTEGER PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
-- Seed each year above existing standard-format order numbers; never lower a counter.
INSERT INTO "OrderSequence" (year, value)
  SELECT split_part("orderNumber", '-', 2)::integer, max(split_part("orderNumber", '-', 3)::integer)
  FROM "Order" WHERE "orderNumber" ~ '^ORD-[0-9]{4}-[0-9]+$' GROUP BY 1
ON CONFLICT (year) DO UPDATE SET value = GREATEST("OrderSequence".value, EXCLUDED.value);

CREATE TABLE IF NOT EXISTS "EmailDelivery" (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  "ownerOrganizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, "leaseId" TEXT,
  "lockedUntil" TIMESTAMP(3), "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
COMMIT;

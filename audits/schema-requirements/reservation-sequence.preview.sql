-- LOCAL REHEARSAL ONLY. Not a Prisma migration or approved deployment script.
-- Exact reservation/sequence section of 20260929100000_protect_distributor_lifecycle.
-- Overlaps that pending migration: do not apply both or mark the full migration applied.
-- Run only in a disposable local database; see README.md for unresolved blockers.
BEGIN;
LOCK TABLE "Order", "OrderKiosk", "Kiosk" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "Kiosk" ADD COLUMN "reservedOrderId" TEXT;
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
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_reservedOrderId_fkey" FOREIGN KEY ("reservedOrderId") REFERENCES "Order"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Kiosk" ADD CONSTRAINT "kiosk_reservation_state" CHECK ((status IN ('RESERVED','ASSIGNED')) = ("reservedOrderId" IS NOT NULL));

CREATE TABLE "OrderSequence" (year INTEGER PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);
INSERT INTO "OrderSequence" (year, value)
  SELECT split_part("orderNumber",'-',2)::integer, max(split_part("orderNumber",'-',3)::integer)
  FROM "Order" WHERE "orderNumber" ~ '^ORD-[0-9]{4}-[0-9]+$' GROUP BY 1;

COMMIT;

-- HISTORICAL PREVIEW ONLY. This rollback script was not executed on Supabase.
-- The user chose UNDER_REVIEW; repair-existing-order.ts committed and verified
-- that repair. See order-repair-20260930071923982.json. Do not rerun this preview.
-- Proposed treatment: return the unfulfilled, unpaid request to review. Preserve
-- its ID, quantity, parties, financial amounts, invoice references and history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE target "Order"%ROWTYPE;
BEGIN
  SELECT * INTO target FROM "Order"
    WHERE id='afd69339-3d50-4fb5-b176-cd0322b1ae79' FOR UPDATE;
  IF NOT FOUND OR target."orderNumber" <> 'ORD-2026-721401-59'
    OR target.type <> 'REQUEST' OR target.status <> 'APPROVED' OR target."paymentStatus" <> 'PENDING'
    OR target.quantity <> 20 THEN
    RAISE EXCEPTION 'Order no longer matches the reviewed state; inspect again';
  END IF;
  IF EXISTS (SELECT 1 FROM "OrderKiosk" WHERE "orderId"=target.id)
    OR EXISTS (SELECT 1 FROM "KioskAssignment" WHERE "orderId"=target.id) THEN
    RAISE EXCEPTION 'Order has acquired kiosk history; do not change its state';
  END IF;
  UPDATE "Order" SET status='UNDER_REVIEW', "updatedAt"=CURRENT_TIMESTAMP WHERE id=target.id;
END $$;
SELECT id, "orderNumber", status, "paymentStatus", quantity FROM "Order"
  WHERE id='afd69339-3d50-4fb5-b176-cd0322b1ae79';
ROLLBACK;

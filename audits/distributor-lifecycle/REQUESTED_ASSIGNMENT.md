# Requested running-app assignment: all kiosks

Read-only preflight: 2026-09-29. **No ownership, order, payment or schema changes made.**

## Follow-up: transfer behavior verified

The user clarified that the objective is to check whether machines move from
Company ownership to Distributor ownership. This passed with **130 synthetic
kiosks in an isolated, fully migrated local database**: Company-owned 130 to 0;
Distributor-owned 0 to 130. Reservation/dispatch did not prematurely transfer
ownership, and delivery updated inventory, assignment history and UI names.

Verification: **107 HTTP requests, 30 assertions, zero mismatches**. The running
database was not changed. This proves the current code with its required schema;
it does not claim the current running database's migration/order issues are fixed.

[Transfer results and screenshots](20260929093320592/TRANSFER.md).

Repeat the local verification:

```powershell
$env:AUDIT_PHASES='transfer_130'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

## Confirmed target and inventory

- Recipient: **Test Distributor Pvt Ltf** (exact name match).
- Recipient ID: `67abc491-0fec-4385-a8b9-ed95c4b94f08`.
- Supplier: NileeGames test, `bbba8db6-0e6b-4482-8194-c5d3f7f9bf52`.
- Inventory: **130 AVAILABLE kiosks**, all supplier-owned; no open assignments.
- Network `f0eb0899-c848-4ba7-81a7-b4737d931afe`: ACTIVE for these exact parties.
- Agreement `de5f1c6f-6481-4f61-b351-1c0779b63752`: ACTIVE for these exact parties.

## Existing order requiring reconciliation

`ORD-2026-721401-59` (`afd69339-3d50-4fb5-b176-cd0322b1ae79`) already requests
20 kiosks for this Distributor. It is APPROVED, payment is PENDING, and it has
zero linked kiosks. Its grand total is INR 3,180,000.

The lifecycle migration refuses this inconsistent active order. The running
database also lacks `Kiosk.reservedOrderId`, `OrderSequence`, `EmailDelivery` and
the new Organization profile columns. Two applied historical migrations are
absent from this checkout. An ownership assignment through the current order
handlers cannot proceed until schema and order reconciliation are addressed.

## Concrete order-flow plan, pending payment/test-data clarification

The user authorized the recipient and the full inventory quantity. The missing
information is whether payment/delivery states may be simulated as test data,
or must represent actual business events. A request to assign kiosks does not
establish that payment was received.

1. Validate the required migration and targeted existing-order repair against a
   local copy of the affected schema/state before any configured-database writes.
2. Preserve the existing order and allocate its missing 20 kiosks, rather than
   creating another order for those same 20. Recheck stock under locks.
3. Allocate the remaining 110 in batches of 50, 50 and 10, respecting the API's
   maximum of 50 per order and reusing the existing agreement terms.
4. Complete payment/dispatch/delivery only with the appropriate real or explicitly
   simulated payment/delivery basis. Do not send invoice emails without authorization.
5. Verify exactly 130 kiosks and 130 open assignments belong to the recipient,
   each order links its exact quantity, and the running Kiosks UI shows the name
   on every page. Preserve assignment history and evidence of any data repair.

Current agreement totals, including the existing 20-kiosk order:

| Component | Per kiosk (INR) | 130 kiosks (INR) |
| --- | ---: | ---: |
| Deposit | 100,000 | 13,000,000 |
| Non-refundable fee | 50,000 | 6,500,000 |
| GST on fee (18%) | 9,000 | 1,170,000 |
| Total | 159,000 | **20,670,000** |

These are calculated agreement amounts, not a statement that money was paid.
Evidence: [requested-assignment-preflight.json](requested-assignment-preflight.json).

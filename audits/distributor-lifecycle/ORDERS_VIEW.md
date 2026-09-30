# Orders & Requests view

Verified 2026-09-29. Company and Distributor navigation now includes Orders.
The screen reads real orders involving the signed-in organization, with order
number search, status and incoming/outgoing filters, quantity, counterparty,
dates and a View dialog. It preserves the existing light/dark dashboard design.
The dialog displays stored financial totals, payment status and actual linked
kiosk codes, models and current states. Loading, retry, empty and filtered-empty
states are included. The table scrolls horizontally on small screens; the dialog
fits the viewport and its content scrolls vertically.

An order remains visible to its original Company/Distributor parties after
delivery transfers kiosk ownership. Direct test assignments with `orderId = null`
are excluded, as explicitly requested. No synthetic orders are created.

## API and query behavior

- Existing `GET /api/orders` now includes organization type in its safe party
  references. Status uses the existing backend `status` parameter; search and
  direction operate locally because the API does not support those parameters.
- New `GET /api/orders/:orderId` validates UUID input and requires active membership
  in the parent or child organization. Other organizations receive 404. Linked
  kiosk fields are limited to id, machineCode, model and status.
- List keys include organization and status; detail keys include organization and
  order ID. Reads support cancellation, refresh and 30-second foreground polling.
- No Prisma, reservation, assignment, payment, dispatch or delivery behavior changed.
  The screen does not add order creation or commercial transition controls.

## Verification

Backend TypeScript and frontend typecheck passed. Frontend lint passed with zero
errors and the existing 62 warnings. `git diff --check` passed.

Isolated run: `20260929114444300`, 50 HTTP requests, 22 assertions, zero mismatches.
See [evidence](20260929114444300/evidence.json) and the reproducible
[phase](harness/phases/orders_display.ts). The run covers:

- Actual request/allocation creation, payment, dispatch and delivery through HTTP
  on a fresh local database, with email captured rather than sent.
- Company retains order visibility and both linked models after two kiosks
  transfer to the Distributor; Distributor ownership and visibility are verified.
- Anonymous, inactive and unrelated organization access; valid staff reads;
  malformed/absent order IDs and invalid status responses.
- Browser navigation, refresh after transfer, status query parameters, both
  directions, case-insensitive search, empty states, Company/Distributor perspectives,
  light/dark screenshots and a 390px mobile dialog without page overflow.
- No browser JavaScript errors; existing local database and application sources
  remained unchanged by the harness. The first attempt stopped because a test
  locator matched both a select option and a badge; scoping it to the order row
  corrected the test, and the rerun passed.

Run from the repository root with the frontend running on localhost:3000:

```powershell
$env:AUDIT_PHASES='orders_display'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

A separate browser check used the running frontend/API and configured database
with GET requests only. List, detail and `?status=APPROVED` returned 200. It showed
one real order, `ORD-2026-721401-59`, and no artificial orders for the three direct
test assignments. The detail explicitly reports its existing inconsistency:
quantity 20 but zero linked kiosks. This was not repaired; the previously
documented migration/deployment blockers remain. Initial network-idle navigation
timed out; the repeat awaited the actual order content and completed successfully.
Live screenshots are in `%TEMP%/arcadelx-live-orders`.

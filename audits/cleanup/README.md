# Local data cleanup

## Fleet cleared (2026-10-07)

`clear-fleet.cjs` emptied the Machines data on the local database, at the owner's
request, to give a clean baseline for machine testing. It removed **47 kiosks, 12
assignment rows, 75 transactions and 10 order links**, and reset `MachineSequence` for
the current year to 0 so the next Add Machine starts at `A001` against an empty fleet.

Deleting a `Kiosk` is blocked by three `RESTRICT` foreign keys, so the dependents were
deleted first in one transaction: `OrderKiosk` -> `KioskAssignment` -> `Transaction` ->
`Kiosk`. Releasing a reservation needs `status` and `reservedOrderId` to change together,
because the `kiosk_reservation_state` check constraint ties them.

Kept, by explicit request:

- Orders and invoice records. ORD-2026-00004 is `APPROVED` and keeps its
  `invoiceFilename`/`invoiceUrl`, so that invoice now references machines that no longer
  exist. Its `OrderKiosk` links were removed, which is what allowed the delete.
- Agreements, network connections, organizations, users, memberships and audit rows.
- `OrderSequence` was deliberately **not** reset: the surviving orders' numbers must stay
  unique.

Two consequences worth knowing:

- **The 3 real payments imported from the payment feed were deleted with the fleet.** The
  sync is idempotent and the feed is public, so re-running
  `audits/revenue-trend/fetch-live-payments.ts` restores them -- but it needs a kiosk whose
  `machineCode` matches the feed's `device_id` (`ADLX-2026-A005`).
- **Revenue is now zero** (the other 72 transactions were seed data).

`fleet-cleared.json` records the removed machine codes, the restored-feed transaction ids
and the before/after counts. Verified afterwards: API and web TypeScript pass, all three UI
suites pass (28 + 19 + 16), and the live sweep returns HTTP 200 for all 15 pages with 0
failed API calls and 0 console errors. Machines shows "No machines in your inventory.",
Overview shows 0 kiosks, and Orders still lists its 3 orders.

## Orders cleared (2026-10-07)

At the owner's request `clear-orders.cjs` removed all order data: **3 orders**
(ORD-2026-00001, 00002, 00004), the invoice `EmailDelivery` row keyed on
`order:<id>:invoice`, the rendered invoice PDF, and `OrderSequence`, which was reset to 0
so the next order numbers from `ORD-<year>-00001`.

The orders were `UNDER_REVIEW` x2 and `APPROVED` x1 (the approved one carried the issued
invoice). Nothing else depended on them: `OrderKiosk` and `Kiosk.reservedOrderId` were both
empty, and `KioskAssignment.orderId` was empty too -- checked before the transaction because
those first two columns are RESTRICT and would otherwise block the delete, while
`KioskAssignment.orderId` is SET NULL and would have been silently rewritten.

Kept and verified unchanged: kiosks (6), their ownership assignments (6), the imported
transactions (3), agreements (2), connections, organizations and users.

Order data on disk is gone as well. `apps/api/invoices/` held one orphan invoice,
`ORD-2026-00002.pdf` (166 KB, dated 2026-10-01), left by an earlier order that no longer
existed. It was **untracked, so it is not recoverable from git**; it was removed because it
is order data and nothing referenced it. No invoice PDFs remain.

## Database reduced to the company login (2026-10-07)

At the owner's request `clear-database.cjs` reduced `arcadelx_local` to a single account,
keeping **only the company login** and no other data:

| Kept | Rows |
| --- | ---: |
| `Organization` (the COMPANY) | 1 |
| `User` (its owner) | 1 |
| `Membership` (OWNER, ACTIVE) | 1 |
| `_prisma_migrations` (migration history, not data) | 13 |

Removed: 7 organizations (every distributor and partner), 11 users, 11 memberships, 116
refresh tokens, 2 agreements, 2 network connections, 6 kiosks, 6 assignments, 3
transactions, 4 email deliveries, 10 revenue sync logs, 1 password reset, and all orders.
Both sequences were reset to 0.

Sign-in was verified **before** the wipe (the owner's password matched, membership OWNER +
ACTIVE) and again **after** it over HTTP, because deleting the account would otherwise have
locked the operator out: login returns 200 and `/api/auth/me` resolves the COMPANY as
`ArcadeLX Local`. All three workflow readiness flags remain true. No application code, route
or API surface was changed -- this is data only.

The owner's 93 accumulated refresh tokens were cleared as session clutter rather than
account data; a fresh login reissues them, and 4 exist again after the verification runs.

Afterwards the devices and payments feeds were re-synced
(`audits/revenue-trend/fetch-live-devices-and-payments.ts`), restoring 6 machines and the 3
real payments, so **ADLX-2026-A005 reports ₹3** (₹2 this month). Both syncs are idempotent --
the second run inserts nothing.

Final state: 1 organization, 1 user, 6 kiosks, 6 assignments, 3 transactions, 2 sync logs.

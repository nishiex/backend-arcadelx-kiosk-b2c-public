# Backend change and function verification

This document records the backend functions checked against the audit reports.

## 1. Member approval and rejection

**File:** `apps/api/src/controllers/membership.controller.ts`

- `handleJoinRequest`
  - Implements atomic approval and rejection.
  - Prevents concurrent decisions from both succeeding.
  - Rejects already processed requests.
- `getPendingRequests`
  - Implements pagination.
  - Uses deterministic ordering by `createdAt` and `id`.
  - Uses a consistent count/list transaction.

**Route:** `apps/api/src/routes/member.routes.ts`

- `POST /api/members/requests/:membershipId`

## 2. Organization joining

**File:** `apps/api/src/controllers/auth.controller.ts`

- `joinOrganization`
  - Selects only `id`, `type`, and `inviteCodeExpiresAt`.
  - Avoids optional missing organization columns.
  - Validates the company type and invite expiration.

## 3. Network rejection

**File:** `apps/api/src/controllers/Network/network.controller.ts`

- `rejectConnection`
  - Supports `PENDING` to `REJECTED` transitions.
  - Restricts rejection to the receiving organization.
  - Protects against duplicate or concurrent rejection.
- `deleteConnection`
  - Prevents deletion of rejected history.
  - Prevents deletion when agreement history exists.
- `acceptConnection`
  - Uses a conditional state update.

**Route:** `apps/api/src/routes/Network/network.routes.ts`

- `POST /api/network/:connectionId/reject`

## 4. Agreement rejection

**File:** `apps/api/src/controllers/Agreement/agreement.controller.ts`

- `rejectAgreement`
  - Restricts rejection to the receiving organization's Owner.
  - Only allows rejection of `PENDING_APPROVAL` agreements.
  - Changes the status to `REJECTED`.
  - Records `effectiveTo`.
  - Retains the agreement row and financial terms.
  - Uses organization locking.
- Existing agreement creation logic allows a new proposal after rejection.

**Route:** `apps/api/src/routes/Agreements/agreement.routes.ts`

- `PATCH /api/agreements/:agreementId/reject`

## 5. Order rejection

**File:** `apps/api/src/controllers/Orders/orders.controller.ts`

- `rejectOrder`
  - Checks workflow readiness.
  - Allows rejection only for eligible unpaid request orders.
  - Rejects orders with kiosk links, reservations, or assignment history.
  - Changes only the order status.
- `createOrder`
  - Checks order workflow readiness.
- `approveOrder`
  - Checks order workflow readiness.
- `getOrderInvoice`
  - Validates organization access.
  - Serves invoice files safely.

**Route:** `apps/api/src/routes/Orders/order.route.ts`

- `PATCH /api/orders/:orderId/reject`

## 6. Workflow readiness

**File:** `apps/api/src/services/workflow-readiness.ts`

- `workflowReadiness`
  - Checks network rejection readiness.
  - Checks agreement rejection readiness.
  - Checks order lifecycle readiness.
- `requireWorkflow`
  - Returns a controlled HTTP `503` response when required schema is unavailable.

**Endpoint:** `GET /api/workflows`

## 7. Seed persistence

**File:** `apps/api/prisma/seed.ts`

- `main`
  - Reads `SEED_*` environment variables.
  - Supports `--check`.
  - Uses a transaction and PostgreSQL advisory lock.
  - Creates the User, Company, and Owner Membership atomically.
  - Preserves existing records.
  - Detects invalid existing ownership.
  - Does not log passwords.
  - Uses bcrypt password hashing.

## 8. Production configuration

**File:** `apps/api/src/config/env.ts`

Production validation covers:

- Required secrets.
- Mailjet credentials.
- Verified sender information.
- HTTPS frontend login URL.
- Absolute `INVOICES_DIR`.
- Valid port and token expiry settings.

**File:** `apps/api/package.json`

Available scripts:

- `build`
- `start`
- `typecheck`
- `db:migrate`

Runtime dependencies include `tsx` and `cookie-parser`.

## 9. Invoice handling

**File:** `apps/api/src/services/pdf/invoice.pdf.ts`

- `renderInvoicePDF`
- `generateInvoicePDF`

The implementation supports configurable persistent invoice storage, embedded fonts and logo assets, financial snapshots, GST and currency formatting, and path traversal protection.

## 10. Database schema and migration

**Migration:** `apps/api/prisma/migrations/20260930070000_request_rejections/migration.sql`

Adds `REJECTED` to:

- `NetworkStatus`
- `AgreementStatus`

The Prisma schema includes `REJECTED` in:

- `MembershipStatus`
- `NetworkStatus`
- `AgreementStatus`
- `OrderStatus`

## Remaining items

1. The order lifecycle migration `20260929100000_protect_distributor_lifecycle` remains unapplied to the configured database.
2. The historical migration sources `20260928063729_implement_transactions_schema` and `20260928073023_remove_payu_retries` remain missing.
3. Order creation, approval, and rejection remain protected by HTTP `503` readiness responses until schema reconciliation is complete.
4. `getPendingNetworkRequests` uses a transaction but does not explicitly use `RepeatableRead` isolation.
5. `acceptConnection` uses a safe conditional update, but its update and follow-up read are not grouped in one explicit transaction.
6. `apps/api/src/routes/Orders/order.route.ts` contains a stale comment saying only Company can approve, while the implementation permits Company and Distributor Owner/Admin users.
7. `apps/api/src/routes/Orders/order.route.ts` contains an unresolved `implement requirerole in get routes` TODO.
8. Invoice delivery has manual retry support but no automatic background retry worker.
9. Rejection transitions are protected at the application level; the rejection migration does not add database-level transition constraints.

## Final status

The checked backend contains the audited member approval/rejection, network rejection, agreement rejection, order rejection logic, workflow readiness checks, join compatibility fix, seed persistence improvements, production validation, and invoice persistence improvements.

The primary remaining functional blocker is the unresolved order lifecycle migration and migration-history reconciliation.

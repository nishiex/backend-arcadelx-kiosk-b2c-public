# Backend working guide

Updated 2026-09-29 after F1–F11 fixes. Applies to `apps/api`, especially `src` and
`prisma`. Recheck relevant implementation when editing. The original
[Distributor audit](../../audits/distributor-lifecycle/REPORT.md) describes the
pre-fix implementation; current behavior, evidence and deployment status are in
[FIXES.md](../../audits/distributor-lifecycle/FIXES.md).

## Change discipline

- Keep changes focused and preserve unrelated working changes.
- Trace route, middleware, controller, shared validation and database relations;
  check frontend callers when changing API contracts.
- Preserve organization scoping, role checks, cookies, response shapes, commercial
  terms and assignment history unless the task explicitly changes them.
- Edit Prisma models through `prisma/schema.prisma` and new migrations. Do not
  hand-edit `src/generated/prisma` or rewrite deployed migrations.
- Do not reset, reseed or delete existing data merely to start the application.
- Keep credentials in ignored environment files, not documentation or test logs.
- Do not apply migrations or mutation tests to a configured remote database by
  assumption. Keep this guide current when behavior changes.

## Environment and deployment status

Production preparation after commit `9b5ef9a` adds `npm run build`, `npm start`,
`npm run typecheck`, and `npm run db:migrate` in the API workspace. `tsx` and
`cookie-parser` are runtime dependencies. Build with development dependencies,
generate Prisma before pruning, and retain source/shared validators/assets.
Production startup validates mail configuration, HTTPS `FRONTEND_LOGIN_URL`,
port/expiry syntax, and an absolute `INVOICES_DIR` on operator-provided persistent
storage. The directory defaults to `process.cwd()/invoices` outside production.
These changes do not reconcile or migrate the configured database. See
[production audit and deployment recipe](../../audits/PRODUCTION_READINESS.md).

The root environment currently targets **Supabase**, superseding the connection
description in the root setup document. This checkout has ten migrations,
including the new, unapplied `20260929100000_protect_distributor_lifecycle`.
The configured database has eleven historical migrations, including two absent
from this checkout. Local Docker `arcadelx-pg` on port 5433 has an older `arcadelx`
database with six migrations. Do not assume either schema matches the new client.

Read-only preflight found one existing approved/dispatched order with an incorrect
linked-kiosk count. The new migration intentionally refuses that data. Reconcile
the order and database-only migration sources before deploying. No remote repair
or migration was performed. Regression tests use newly created local databases.

Subsequent user-requested test setup in the configured database added a dedicated
ACTIVE Distributor ADMIN login and three standalone kiosk assignments to
**Test Distributor Pvt Ltf**. Current stock is Company 127, Distributor 3.
These are direct test-data assignments with `orderId = null`, not paid/delivered
orders; the existing 20-kiosk order and migration blockers are unchanged.
See [running test assignment evidence](../../audits/distributor-lifecycle/running-model-transfer/README.md).

The Distributor list now tolerates older or partially migrated profile columns:
it reads column availability and selects only fields that exist, returning null
for unavailable GST/phone/country. This restores listing on the configured DB;
organization creation and other lifecycle writes still require the full migration.
See [the listing fix](../../audits/distributor-lifecycle/DISTRIBUTOR_LIST_FIX.md).

API port is 4000; frontend is 3000. `src/server.ts` loads root `../../.env` and
dynamically imports the app. Run from `apps/api` so relative environment and
invoice paths resolve correctly. Runtime uses `DATABASE_URL`; Prisma CLI config
loads root environment and uses `DIRECT_URL`. The frontend at
`../web/next-monorepo/apps/web` rewrites `/api/:path*` to `BACKEND_API_URL`.

Before starting the updated API, explicitly select a compatible, fully migrated
database. Check existing listeners/container state before launching duplicates.
`/health` checks HTTP and `/health/db` executes `SELECT 1`; neither proves schema
compatibility or correctness of the lifecycle.

## File map

| Location | Responsibility |
| --- | --- |
| `src/app.ts`, `src/server.ts` | Middleware, route mounts, health checks, startup |
| `src/config/env.ts` | Zod environment validation |
| `src/middlewares/auth.ts` | Cookie JWT auth, active membership, role/org gates |
| `src/middlewares/internal.auth.ts` | Internal shared-secret auth |
| `src/controllers`, `src/routes` | Business operations and endpoint permissions |
| `src/services/agreement-rules.ts` | Locked relationship and agreement-slot checks |
| `src/services/email/delivery.service.ts` | Transactional encrypted delivery queue and retry |
| `src/services/email` | Mailjet credentials, reset and invoice messages |
| `src/services/pdf/invoice.pdf.ts` | Local PDF invoice generation |
| `src/utils` | Prisma client, tokens, response/error wrappers |
| `prisma/schema.prisma`, `prisma/migrations` | Models, enums, SQL constraints/backfills |
| `../../packages/shared-types/validationSchemas` | Shared Zod request schemas |
| `../../audits/distributor-lifecycle/harness` | Real HTTP/DB regression and migration checks |

TypeScript uses ESM and `@shared-types/*` aliases. Prisma uses `@prisma/adapter-pg`.
Success responses use `{statusCode,data,message,success}`; errors use
`{success,message,errors}`. Zod and malformed JSON return 400, known database
conflicts 409, missing records 404. Unexpected errors return 500 without exposing
exception messages.

## Authentication and route permissions

A User has at most one Membership (`userId` is unique). Membership must be ACTIVE
for protected organization operations; PENDING/REJECTED cannot mutate lifecycle
data. Roles are OWNER > ADMIN > MANAGER > STAFF. Types are COMPANY, DISTRIBUTOR,
PARTNER. Organization registration creates owner, organization, active owner
membership and credential-delivery job in one transaction; it does not switch
the creator's login session.

| Base path | Gates in addition to authentication and active membership |
| --- | --- |
| `/api/auth/register` | COMPANY/DISTRIBUTOR OWNER/ADMIN; distributor creates only partners |
| `/api/auth/organizations/:organizationId/credentials/retry` | COMPANY/DISTRIBUTOR OWNER/ADMIN; queued-delivery creator organization |
| `/api/members` | COMPANY OWNER/ADMIN; role hierarchy limits additionally apply |
| `/api/network` | Initiate: COMPANY/DISTRIBUTOR OWNER/ADMIN; requests/accept: OWNER/ADMIN; distributors list: COMPANY; delete: initiating COMPANY/DISTRIBUTOR OWNER |
| `/api/agreements` | Create/terminate: COMPANY/DISTRIBUTOR OWNER; approve: child OWNER |
| `/api/kiosks` | Batch: COMPANY OWNER/ADMIN; status: COMPANY/DISTRIBUTOR OWNER/ADMIN; inventory reads: active member with controller scoping |
| `/api/orders` | Create/approve/paid/dispatch/deliver/invoice retry: COMPANY/DISTRIBUTOR OWNER/ADMIN; order/invoice reads: scoped active member |
| `/api/internal` | `X-Internal-Api-Key`, not user cookies; existing pairing rules remain |

Organization-type gates do not imply role gates. Public auth includes join,
login, refresh and forgot-password/reset flows. Unknown invite codes return 404.
Access JWT uses `access_token`; refresh JWT uses `refresh_token` scoped to
`/api/auth/refresh`. Cookies are HTTP-only, SameSite Strict, Secure in production.
`POST /api/auth/refresh/logout` revokes the presented refresh session and clears
both cookies using their original paths/options. It requires no access-token or
membership gate, so expired and inactive sessions can sign out; repeated logout
is safe. The nested URL is required to receive the existing refresh cookie.
The frontend waits for an in-flight refresh, prevents new automatic refreshes
during logout, clears its query cache after success and navigates to `/login`.
Failures show a retryable error. [Logout verification](../../audits/distributor-lifecycle/LOGOUT_FIX.md).
Stored refresh/reset tokens are hashed. Password changes/resets delete stored
refresh tokens. Existing access JWTs remain valid until expiry.

## Networks and agreements

Connections move PENDING → ACTIVE only once by receiver acceptance. Canonical
pair uniqueness prevents duplicate or reversed network rows. Deletion locks the
connection and refuses **all** agreement history, including terminated/pending.

Agreement creation/approval locks the child organization and network, checks
exact ACTIVE initiator/receiver endpoints and hierarchy, and rechecks pending or
active conflicts. SQL additionally enforces one pending/active agreement per
parent/child pair. Application checks serialize competing Distributor suppliers
for the same Partner. Creation starts PENDING_APPROVAL, child approval activates,
parent termination retains the row and sets `effectiveTo`.

Company agreements require explicit shares totaling 100 and explicit amounts.
Distributor → Partner shares stay 60/40 and inherit amounts from the active
Company agreement. Amounts are nonnegative whole currency units within PostgreSQL
Int range; fractional inputs are rejected. Order amounts remain Float snapshots.
Changing currency precision requires a coordinated model/math migration.

F12 termination policy is unchanged: termination does not cascade to downstream
agreements or cancel already-created orders. Do not infer a new policy from the
F1–F11 fixes.

## Kiosks, orders and assignment history

Company batch size is 1–100, using the existing atomic yearly MachineSequence.
New kiosks are AVAILABLE and company-owned. Company inventory can see all kiosks;
Distributor/Partner inventory is ownership-scoped. Summary is current-org scoped.
Public kiosk responses omit `externalDeviceId`; internal pairing remains separate.

Kiosk list and detail responses include `currentOrg` and `assignedOrg` display
references (`id`, `name`, `type` only). `currentOrg` resolves current ownership;
`assignedOrg` resolves the latest open assignment, excluding closed history.
No open assignment returns null. Explicit projections avoid selecting undeployed
profile/reservation columns. Company stock still displays as Unassigned in the UI.
See [Assigned To verification](../../audits/distributor-lifecycle/ASSIGNED_TO_FIX.md).

The frontend Company dashboard and Kiosks screen now show only the signed-in
organization's currently owned machines, using `useOwnedKiosks`. The Company API
retains its existing broad read access. Delivered machines disappear from Company
inventory views and appear for the Distributor. Counts in the Distributor list
remain visible to the Company. [UI verification](../../audits/distributor-lifecycle/OWNED_INVENTORY_FIX.md).

Order quantity is 1–50. REQUEST treats target as supplier and begins UNDER_REVIEW;
ALLOCATION treats current organization as supplier, reserves stock immediately
and begins APPROVED. OrderSequence allocates unique per-year numbers atomically.

1. Reservation selects parent-owned AVAILABLE stock with row locks and
   `SKIP LOCKED`, verifies the quantity, sets RESERVED plus `reservedOrderId`, and
   creates historical OrderKiosk references in one transaction.
2. Payment requires APPROVED; dispatch additionally requires PAID.
3. Dispatch validates locked stock ownership, quantity, state and order pointer,
   then sets kiosks ASSIGNED and order DISPATCHED.
4. Delivery revalidates the same data and open assignment owner under locks, closes
   history, creates child assignments, transfers ownership, resets AVAILABLE and
   location, clears reservation and marks DELIVERED atomically.

Manual status updates lock stock and cannot enter/leave RESERVED or ASSIGNED or
alter an order reservation. Other transitions are explicitly listed in the kiosk
controller; RETIRED cannot be reactivated. Installation still requires location.

Preserve SQL-only constraints: the single COMPANY index; canonical network pair;
distinct agreement/network parties; nonnegative agreement money; one open
agreement per pair; one open assignment per kiosk; and equivalence between an
active reservation pointer and RESERVED/ASSIGNED status. OrderKiosk is historical
and remains unique by `(orderId,kioskId)`, not globally by kiosk.

New migration backfills active reservation pointers and yearly order counters,
repairs invoice URLs, and refuses duplicate/ambiguous/inconsistent legacy state.
It never silently deletes history to satisfy constraints.

## Invoices and delivery recovery

Financial snapshots use agreement amounts times quantity, 18% GST on the
non-refundable total, and their sum as grand total. Invoice files reside under
`INVOICES_DIR` when configured (required absolute persistent path in production),
otherwise `process.cwd()/invoices`; persisted URLs use `/api/orders/:orderId/invoice`.
Downloads require membership in the order's parent or child organization.

Order invoices use a branded A4 layout with embedded Lato fonts (including the
rupee glyph), Indian currency grouping, charge rows and a GST/total summary.
Ship `src/assets/fonts` and `src/assets/invoice-logo.png` with the API. Downloads
render the current design from saved order amounts after the existing access and
archive-availability checks; archived PDFs and order/payment rows are not changed.
Newly generated email attachments use the same renderer. Downloads are private
and not cached. `AUDIT_PHASES=happy,fixes,invoice_layout` verifies generation,
recovery, refreshed downloads, archive preservation and organization access.

EmailDelivery jobs are created in the same transaction as the organization or
approved order. PDF/email failure does not turn a committed business operation
into an HTTP failure: response flags indicate `credentialsEmailSent`, or
`invoiceEmailSent` and `invoiceReady`. The creating organization can explicitly
retry credentials or `POST /api/orders/:orderId/invoice/retry`. Retry returns
200 for sent/already sent or 202 while pending, with no new account/order or
password rotation.

Payloads use authenticated encryption derived from `INTERNAL_API_SECRET`; keep
it stable while jobs are pending. Successful delivery clears payloads. A two-minute
lease limits concurrent attempts and expires after a crashed process. External
provider ambiguity can still duplicate email; delivery is not exactly-once.
There is no automatic background retry worker or new frontend retry button.

## Remaining boundaries and verification

F13 browser UI lifecycle is outside this backend fix. REJECTED orders and
FAILED/REFUNDED payments still have no dedicated transition handlers. Existing
refresh-token same-second generation, revoked-token handling and configured
expiry discrepancies were not changed. Password changes still verify the supplied
email/password; they were not redesigned around authenticated user ID.

Run from repo root against isolated test databases:

```powershell
npx.cmd tsc --noEmit -p apps/api/tsconfig.json
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/migration-upgrade.ts
```

Main regression defaults to `happy,fixes`, captures email in memory and fails on
unexpected results. The old negative/concurrency/integrity audit phases reproduce
historical defects and should not be treated as post-fix expectations. See
FIXES.md for exact evidence and explicit read-only preflight command.

For schema changes validate Prisma, inspect the new migration and data impact,
then regenerate via Prisma CLI. Do not reset a database as validation. The current
`npm test` remains a placeholder; documentation-only edits need no runtime tests.

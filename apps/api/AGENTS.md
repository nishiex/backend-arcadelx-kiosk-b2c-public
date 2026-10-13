# Backend working guide

## Machine-code numbering fixes (2026-10-07)

Two defects surfaced once the device feed started registering kiosks under their own
`device_id`, and both broke ordinary operations:

1. **Add Machine failed with 409 on any database that contained synced devices.** The batch
   generator mints `ADLX-<year>-A<nnn>` from `MachineSequence`, while the device sync
   registered `ADLX-2026-A001`/`A002`/`A003`/`A005` at counter 0 without advancing it. The
   next batch tried to mint `ADLX-2026-A001`, collided on the unique `Kiosk.machineCode`, and
   the whole transaction failed. `services/machine-code-sequence.ts` now returns the counter
   floor a synced code occupies, and the sync raises `MachineSequence` with
   `GREATEST(value, floor)` so the two writers share one numbering space.

2. **Pairing hardware conflicted with the kiosk's own opening assignment.** Pairing calls
   `recordOpeningAssignments`, but batch create had already opened one, and
   `KioskAssignment_one_open_key` is a partial unique index on `(kioskId) WHERE assignedTo IS
   NULL` -- so the second insert raised a unique-violation, reported as 409. The helper is now
   idempotent: it skips kiosks that already have an open assignment.

Neither was reachable before the device feed was configured, because nothing else registered
kiosks outside the batch generator.

Verified after the fix, driving the real dialog in a browser rather than the endpoint:
Add Machine minted `A006`, then `A007..A008`, with **zero failed API calls and no 409**, and
every new machine received its opening assignment. Pairing returns 200 with exactly one
assignment. Re-checked from a wiped fleet: a fresh sync raises the counter to **5** (not 0),
so the next Add Machine mints `A006` instead of colliding -- the ordering of "sync then mint"
no longer matters. Evidence: `audits/health/add-machine-result.png` and
`audits/health/add-machine-ui-check.json`.

The internal routes authenticate with the **`X-Internal-Api-Key`** header
(`middlewares/internal.auth.ts`), not `x-internal-secret`; a wrong header name returns 401
"Missing internal authentication key".

## Live device and payment feeds (2026-10-07)

Both public feeds are configured in the ignored root `.env` (and documented in
`.env.example`):

| Key | Endpoint | Purpose |
| --- | --- | --- |
| `MOTHERSHIP_DEVICE_API_URL` | `/api/v1/devices` | Registers/freshens kiosks and their `externalDeviceId` |
| `MOTHERSHIP_TRANSACTION_API_URL` | `/api/v1/payments` | Reads the payment feed; scheduled sync imports completed payments |

`externalDeviceId` is documented in `internal.controller.ts` as "Mothership's UUID (The
Link)", and the payment sync resolves a kiosk by it (then by `machineCode`), so the device
feed is what makes payments attributable. `syncDevices` in
`services/Revenue/deviceSync.service.ts` therefore runs **before** `syncRevenueData` in the
worker's `sync-transactions` job; devices are processed oldest-seen first so a numbering gap
is filled by the earliest device. An unknown device becomes an `AVAILABLE` kiosk owned by the
company, keeping the device id verbatim as its machine code. Nothing is deleted: the feed is
a snapshot, and hardware can simply be switched off.

Three rules this work established, each of which cost a debugging cycle to find:

1. **Registering a kiosk must open an ownership assignment.** `getMachineWiseRevenue`
   iterates `KioskAssignment` and only counts payments inside an assignment window, so a
   kiosk with no assignment row reports no revenue even when its transactions are stored.
   `services/kiosk-ownership.ts` opens one on batch create, on device pairing, and on
   device sync.
2. **The window must cover the payment's own date.** An assignment opened "now" leaves a
   historical payment outside every window, so the row is stored but never attributed.
   `ensureAssignmentCovering` backdates the kiosk's open assignment to the payment when
   needed; backdating rather than inserting keeps `KioskAssignment_one_open_key` (one open
   row per kiosk) satisfied.
3. **`Transaction.occurredAt` is a naive `timestamp without time zone`** and the API server
   may run in any local timezone. Prisma writes a JS `Date` using the client's local
   offset, so the same instant is stored differently depending on where the server runs.
   This is latent rather than fixed; a container running UTC would shift stored times.

On demand locally (the schedulers need Redis and `REVENUE_JOBS_ENABLED`, both still unset):

```powershell
node -r ./audits/auth-registration/runtime-loader.cjs audits/revenue-trend/fetch-live-devices-and-payments.ts
```

It runs the same two services the worker runs, twice each to prove idempotency, and records
the result in `audits/revenue-trend/live-devices-and-payments.json`.

## Per-device price overrides (2026-10-13)

Device-scoped pricing was broken by our own request body, not by Mothership. The device price
endpoint persists an override only when the body is `{ price, replay_price }`; sending
`{ override_price, override_replay_price }` answers HTTP 200 `{"status":"success"}` while
echoing the *existing* price and saving nothing. That silent no-op is what made every
device-only change look like an unsupported upstream feature, and only the service's read-back
caught it -- an upstream "success" body cannot be trusted on its own.

Confirmed live on one offline device and reverted: `POST
/api/v1/devices/{device_id}/games/{game_id}/price` with `{ price, replay_price }` sets
`has_override=1` with the override price and leaves the catalog and every other device
unchanged; `POST /api/v1/devices/{device_id}/prices/reset` removes the overrides and reports
`removed_overrides`. `audits/devices/verify-device-price-override.ts` drives the real service
through that cycle (it refuses to run without `ALLOW_LIVE_MOTHERSHIP_WRITE=1`) and records
`audits/devices/live-device-price-override.json`. The scope distinction is unchanged: `DEVICE`
is the default and never falls back to `GAME_CATALOG`, which remains the only fleet-wide
change. A device that does not confirm the override still reports 502 rather than success.

## Reservation ordering and company allocation (2026-10-07)

`reserveKiosks` used to select stock with `ORDER BY "createdAt", id LIMIT n`. Since
`id` is a random UUID, kiosks sharing a `createdAt` -- and a batch-created fleet
shares one -- were picked in no meaningful order. An approved 10-kiosk request
therefore received an unexplained, mixed-model set: measured on the local data it
took DEMO-LOCAL-{004,008,003,002,010,011,001,007,012,006} instead of 001..010, and
mixed Arcade-LX B2C, ADLX-Pro-X1 and Arcade-LX Healthcare machines.

Ordering is now `ORDER BY "createdAt", "machineCode", id`. `machineCode` is unique,
so this is a total order: the same inventory always yields the same kiosks, and a
batch follows the machine codes. No schema change was needed.
`audits/distributor-agreement/verify-reservation-order.cjs` proves it through the
API on an isolated fixture and removes everything it creates; the ordering
comparison covers all 15 kiosks of a tied batch, where the old rule provably
differs. The 10 kiosks already reserved by ORD-2026-00004 were deliberately left
alone: that order is APPROVED with an issued invoice and a sent invoice email, so
re-picking its stock would desync the invoice.

**Separate pre-existing defect:** in `createOrder`, the `currentOrgType ===
'COMPANY'` guard throws unconditionally, so it also rejects `ALLOCATION` and the
`else` branch below it is unreachable -- while the message says "use ALLOCATION to
push kiosks". Consequences: a COMPANY cannot create an allocation at all, no
allocation can ever link `OrderKiosk`/invoice rows, and the only reachable
reservation path is a Distributor `REQUEST` being approved (which is how
ORD-2026-00004 reserved its kiosks). That is a product decision I did not change;
fixing it means moving the ALLOCATION branch above the guard.

## Live payment feed (2026-10-07)

The read-only revenue feed uses
`https://main.arcadelx.games/api/v1/payments` by default. Set
`MOTHERSHIP_TRANSACTION_API_URL` in the ignored root `.env` only to override it.
The endpoint is public -- it answers 200 without credentials, which is why the
service fetches it unauthenticated -- so the URL is configuration, not a secret.

`syncRevenueData` previously required a bare JSON array. This feed returns an
envelope (`{ data: [...], status, total }`), so the first sync failed with
"Expected a transaction array". The reader now accepts either shape and still
rejects anything else, rather than treating an unexpected payload as "no records".
Existing sync behaviour is unchanged: only `status: 'completed'` rows are kept, each
is validated, `device_id` is mapped to a kiosk via `externalDeviceId` then
`machineCode`, duplicates are skipped by `txnid`, unattributable rows are counted,
and every attempt is recorded in `RevenueSyncRunLog`.

Nightly and monthly jobs remain **disabled**: `REVENUE_JOBS_ENABLED` and
`REDIS_URL` are still unset, so `startRevenueJobs` never runs. The authenticated
`GET /api/revenue/payments` route exposes the live upstream feed read-only to Company
Owners/Admins; it does not import records or mutate the revenue ledger. `syncRevenueData`
remains the separate importer used by the scheduled pipeline when enabled.

`audits/revenue-trend/fetch-live-payments.ts` runs the existing service against the
configured source (local database only) and records the feed summary, device
mapping, before/after counts, imported rows, both payload-shape acceptance cases and
the API totals in `audits/revenue-trend/live-payments.json`.

## Revenue trend endpoint (2026-10-07)

`GET /api/revenue/series?range=7d|30d|3m|1y` serves the dashboard revenue chart.
It is read-only, additive, and requires no migration. Guards match
`/api/revenue/machine-wise` (`requireOrgType(COMPANY|DISTRIBUTOR|PARTNER)` plus
`requireRole(OWNER|ADMIN|MANAGER)`), and it applies that endpoint's exact scoping:
COMPANY sees all assignments; a DISTRIBUTOR sees its own organization plus Partner
children while the governing agreement is in force; the assignment date window and
the INR-only rule are unchanged. Payments are only counted at or before `now`.

Bucketing lives in `src/services/Revenue/revenue-series.ts` and reuses the
`330 * 60000` (UTC+5:30) IST convention already used by `getMachineWiseRevenue`, so
the two endpoints agree. Granularity is day for 7d/30d, ISO week for 3m, and month
for 1y; every bucket in the range is returned, so gaps chart as zero. The response
is `{ range, granularity, bucket, currency: 'INR', total, points[{ key, label,
revenue }] }`. `getMachineWiseRevenue` was not modified.

Note for test data: `Transaction.occurredAt` is `timestamp without time zone` and
Prisma reads it as UTC (the database session timezone is Etc/UTC). Raw `pg` inserts
must pass a naive UTC wall clock, otherwise the stored day shifts by the client's
offset. `audits/revenue-trend/verify-revenue-series.cjs` proves the endpoint with
temporary rows (including one before the assignment began and one in the future,
both of which must be excluded) and removes them again.

## Local owner contact repaired (2026-10-06)

Both root database URLs target arcadelx_local on localhost:5433. The specific
20261005190000_add_owner_contact migration is now applied and recorded atomically
there. All nine existing users were preserved; a contact insert/leading-zero probe
passed and was rolled back. No remote migration or email was performed. Evidence:
audits/demo-distributors/owner-contact-deployment.json. Other pending migrations
were not applied. The previous local missing-contact registration blocker is fixed.

## Distributor and Partner kiosk requests (2026-10-06)

Active Distributor and Partner OWNER/ADMIN memberships may POST REQUEST orders.
Partners may request from a Company or Distributor only through the exact active
agreement and active network relationship. Partners cannot ALLOCATE or perform
supplier decisions/payment/dispatch/delivery. Existing quantity 1–50, financial
snapshots and readiness gates remain. No migration is required for this change.
`audits/demo-distributors/partner-order-regression.cjs` verifies 25 cases against
a fresh isolated local database using the auth-registration runtime loader.
No live demo statuses or agreements are changed by that test.

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

### Owner contact integrated (2026-10-05)

Backend `1e519e3` is adapted into existing registration. `ownerContact` is required
for new Distributor/Partner owners and must contain ten digits. User.contact is
nullable unique text to preserve legacy/staff/seed accounts and leading zeros;
organization phone and GST remain separate. The shared Prisma client omits
contact unless explicitly requested. Existing auth remains compatible before
deployment, while owner registration returns 503 if the column is missing.
Migration `20261005190000_add_owner_contact` was tested in a new local audit DB;
it has NOT been applied to Supabase. See `audits/auth-registration/OWNER_CONTACT.md`
for compatibility decisions and 204 passing regression checks. No live contacts
were backfilled and no real test emails were sent.

### Revenue backend integrated (2026-10-05)

Revenue functionality from Backend `2d013c9` is integrated alongside the existing
order/auth/invite work. See [integration and verification](../../audits/revenue/README.md).
The schema gains only revenue models and relations. An additive compatibility
migration is checked in the working tree; no remote migration was applied for
this integration. Original upstream SQL is archived for reconciliation.
The three revenue endpoints are mounted under `/api/revenue`. Background jobs
require explicit `REVENUE_JOBS_ENABLED=true`, Redis and a Mothership source URL;
they use the existing BullMQ scheduler and a connected worker. They remain
disabled in the current runtime. PDFs/email use persistent report storage and
the existing leased EmailDelivery queue. Existing organization access fields must
be deployed before activating workers. Tests create local isolated data only.

### Current remote order repair and email verification (2026-10-05)

After explicit user approval, `20261005120000_restore_order_workflow` was
applied to the currently configured Supabase database and recorded atomically.
Four local repair tests passed; all remote preflight checks were clear. The
deployment verified existing business-row fingerprints were preserved, with
zero reservations requiring backfill. All three order prerequisites now exist.
See `audits/order-readiness/deployment.json` for current evidence.
Mailjet authentication and the configured sender's Active status were verified.
One user-requested plain test email was accepted by Mailjet, and the user
confirmed receipt. No account or credential email was created as that test.
Organization profile/access fields remain missing remotely; new-organization
registration requires its separate repair and has not been verified here.

### Supabase settings supplied again (2026-10-05)

The user supplied updated environment settings after local demo verification.
Ignored `.env` now uses Supabase transaction pooler port 6543 for runtime and
session pooler port 5432 for migrations, with the supplied Mailjet settings.
API port remains 4000 and the frontend login URL is localhost:3000/login.
Both database connections pass; read-only checks report `orderDecisions: false`
because the remote order prerequisites are absent. No remote schema or business
data was changed. API restarted with these settings. Mail delivery is unverified.
The preceding local environment was privately backed up in the temporary folder.

### Local database selected again (2026-10-05)

At the user's request, ignored root `.env` was restored from the existing local
backup and both database URLs now target `arcadelx_local` on localhost:5433.
Read-only checks confirm all three workflow readiness flags are true. No database
rows or migrations were changed. The frontend still proxies to localhost:4000.
The API has now restarted on port 4000 with this environment. Health, database
health and local owner login pass. Authenticated workflow checks through both
ports 4000 and 3000 return all three flags true; the verification session was
logged out. Supabase's current schema is missing the three order prerequisites
despite the historical repair below.
The prior environment was backed up privately under the user's temporary folder.

### Order readiness restored (2026-10-05)

After the remote-only revert removed the order prerequisites, the user requested
restoring requests and decisions. Additive migration
`20261005120000_restore_order_workflow` is now applied online and recorded
atomically. It restores Kiosk reservation pointers/constraints, OrderSequence,
EmailDelivery, and the single-open-assignment index. All twelve preflight checks
were clear; existing business-row fingerprints were preserved and ten existing
reserved kiosks were backfilled. Four isolated local repair cases, API typecheck,
and Prisma validation passed. Both API and frontend-proxy `/api/workflows` now
return `orderDecisions: true`. Network/agreement rejection flags remain false
after the separate remote revert. See [repair evidence](../../audits/order-readiness/README.md).

### Current auth repair (2026-10-05)

After the remote revert, additive migration
`20261005121000_restore_registration_fields` restored the five existing
Organization profile/access fields required by registration. Core organization
data was preserved. Existing handlers, sessions, hashing and permissions remain.
Runtime uses the responding port 5432 endpoint of the same online database and
verified saved Mailjet keys in ignored environment configuration. DB health and
108 isolated auth checks pass; actual mailbox delivery remains untested.
Read-only SQL history confirms no local migrations pending and a matching repair
checksum; three remote-only migrations remain. Native migrate status is blocked
by sandbox spawn EPERM. See [current evidence](../../audits/auth-registration/README.md).

### Earlier auth verification (superseded by current repair above)

At the user's request, runtime DATABASE_URL and DIRECT_URL now target the saved
online Supabase database. Current Mailjet keys remain local dummy values. Online
read-only checks found the Organization profile/access fields and EmailDelivery
table; migration history still diverges. Do not infer full lifecycle readiness
from the database health check. The auth chain already uses the existing register,
login, password, session and credential-delivery handlers; no backend change was
needed. A Distributor-only Partner registration form now calls these APIs.
`AUDIT_PHASES=auth_flow` adds isolated auth-chain/session/permission tests.
See [auth flow map and verification](../../audits/AUTH_FLOW.md) for results and
remaining configuration/typecheck/migration issues.

### Local-only development (2026-10-01)

At the user's request, root `.env` now points both `DATABASE_URL` and `DIRECT_URL`
to database `arcadelx_local` on Docker `arcadelx-pg`, localhost port 5433. This is a
fresh database; all twelve checked-in migrations applied successfully and Prisma
reported no difference against `schema.prisma`. The existing local `arcadelx`
database and Supabase were not modified. The original environment is preserved
in the private local env backups (`.env.local-backup-20261005`), excluded via `.git/info/exclude`; keep them private.

The owner/company seed uses the user's selected local test login from ignored
`.env`, with placeholder company details. Mailjet uses dummy local keys, so real
email delivery is unavailable. API runs on 4000 and the existing frontend on 3000.
Health, database connectivity, login through the frontend proxy, and all three
workflow readiness flags passed. The verification login was logged out.

Start Docker Desktop, then `docker start arcadelx-pg`. Run `npm run dev` from
`apps/api` and `apps/web/next-monorepo` in separate terminals as needed. Keep both
database URLs local when using `prisma migrate dev`. Supabase reconciliation
below remains historical pending work, not a prerequisite for this local setup.

### Company seed (2026-09-30)

`prisma/seed.ts` persists the initial Company, owner and ACTIVE OWNER membership in
one transaction. New setup reads validated `SEED_*` values from the root `.env` or
process environment; see `.env.example`. It has no hardcoded company credentials
and never logs passwords. Existing companies are verified without overwriting
their data, and simultaneous seed runs serialize with a transaction advisory lock.
Missing required insert schema or inconsistent existing ownership is reported;
the seed does not repair or migrate the database automatically. Existing-company
checks select only required columns for compatibility with missing profile fields.
Run `npx tsx --tsconfig apps/api/tsconfig.json apps/api/prisma/seed.ts --check` from
the root for a database-enforced read-only check. The configured database passed;
eleven isolated persistence checks and the API typecheck passed. See
[seed behavior and evidence](../../audits/SEED_PERSISTENCE.md).

### Approval/rejection updates (2026-09-30)

Member decisions now atomically update only scoped PENDING memberships; duplicate
or racing decisions return 400. Rejection retains the user/membership and clears
its role. Join selects only Organization ID/type/invite expiry for compatibility
with absent optional profile columns. Member pagination uses an ID tie-breaker
and a repeatable-read count/list snapshot.

Network rejection: recipient OWNER/ADMIN, PENDING -> REJECTED, POST
`/api/network/:connectionId/reject`. Agreement rejection: recipient OWNER,
PENDING_APPROVAL -> REJECTED, PATCH `/api/agreements/:agreementId/reject`, sharing
approval's child-organization lock. Rejected history is retained; rejected network
rows cannot be deleted/reopened. A new agreement proposal can follow rejection.
GET `/api/network` and `/api/agreements` return paginated, party-scoped history to
active OWNER/ADMIN members, with safe organization projections.

Order rejection: supplier COMPANY/DISTRIBUTOR OWNER/ADMIN, PATCH
`/api/orders/:orderId/reject`; only an unpaid REQUEST under review with no inventory
history/reservations qualifies. It never releases approved stock or alters money.
Order create/approve/reject check workflow schema availability and return 503
while unavailable. GET `/api/workflows` exposes readiness to active members.

### Model-specific Distributor/Partner requests (2026-10-13)

`GET /api/orders/request-models` resolves exactly one ACTIVE immediate-supplier
agreement (Partner → Distributor, Distributor → Company) and reports installed,
unreserved model stock less pending requests already claiming that model. Request
creation requires a model and validates that quantity under a supplier row lock.
Approval reserves only the order's persisted `requestedModel` and conflicts if
that model is no longer available; the guarded update repeats the model predicate.
Legacy requests with `requestedModel = NULL` retain their prior any-model approval
behavior.

The additive migration `20261013140000_add_order_requested_model` is required
before deployment and has not been applied by this code change. API typecheck and
mocked Distributor/Partner UI checks do not replace a database-backed lifecycle
test or migration rehearsal.

### Mothership gateway reorder verification (2026-10-13)

The gateway screen POSTs the requested provider order through the authenticated local
proxy. Mothership has returned both HTTP 500 and HTTP 200 without changing priorities.
After a 2xx reorder response, the service reads the gateway list and confirms its
priority order before reporting success; mismatch or failed verification is logged
and returned as 502. The live write is never automatically retried. The upstream
request contract still needs confirmation from Mothership.

The independent `20260930070000_request_rejections` enum migration was applied
to Supabase on 30 September after a local upgrade/Prisma-registration rehearsal;
only its two enum additions were applied, then recorded via `prisma migrate resolve`.
Both rejection readiness flags are now true. Business rows and all old migration
records were preserved. The order lifecycle migration remains unapplied.
See [rejection deployment](../../audits/REQUEST_REJECTION_DEPLOYMENT.md).
On 30 September the user
selected returning ORD-2026-721401-59 to UNDER_REVIEW. That single guarded repair
was tested locally, snapshotted, committed and verified remotely; quantity 20,
payment PENDING, amounts, invoice references and inventory/history were preserved.
All twelve post-repair integrity preflight counts are zero. Nine older migration
checksums match after LF normalization; the two historical transaction migration
sources remain unavailable after the expanded search. See
[current fixes/tests](../../audits/APPROVAL_REJECTION_FIXES.md) and
[reconciliation plan](../../audits/SCHEMA_RECONCILIATION_PLAN.md).

Isolated phases `members`, `approval_edges`, and `rejections` cover these flows.
Run each separately; the last two create their own COMPANY fixtures. The existing
`happy,fixes,distributor_invites,invite_generation_compat` suite also passes.

Production preparation after commit `9b5ef9a` adds `npm run build`, `npm start`,
`npm run typecheck`, and `npm run db:migrate` in the API workspace. `tsx` and
`cookie-parser` are runtime dependencies. Build with development dependencies,
generate Prisma before pruning, and retain source/shared validators/assets.
Production startup validates mail configuration, HTTPS `FRONTEND_LOGIN_URL`,
port/expiry syntax, and an absolute `INVOICES_DIR` on operator-provided persistent
storage. The directory defaults to `process.cwd()/invoices` outside production.
These changes do not reconcile or migrate the configured database. See
[production audit and deployment recipe](../../audits/PRODUCTION_READINESS.md).

Before the local-only switch above, the root environment targeted **Supabase**.
The following describes that remote deployment. This checkout has twelve migrations.
`20260929100000_protect_distributor_lifecycle` remains unapplied;
`20260929123000_distributor_access_status` was applied independently on 2026-09-29
and recorded with Prisma after the user requested enabling the disabled controls.
The configured database has thirteen recorded migrations, including two absent
from this checkout. Local Docker `arcadelx-pg` on port 5433 has an older `arcadelx`
database with six migrations. Do not assume either schema matches the new client.

The original preflight found one approved order with an incorrect linked-kiosk
count. Its user-selected repair is now complete, with all integrity counts zero.
Recover the two database-only migration sources before deploying the lifecycle
fix. Regression tests use newly created local databases.

Subsequent user-requested test setup in the configured database added a dedicated
ACTIVE Distributor ADMIN login and three standalone kiosk assignments to
**Test Distributor Pvt Ltf**. Current stock is Company 127, Distributor 3.
These are direct test-data assignments with `orderId = null`, not paid/delivered
orders; the existing 20-kiosk order and migration blockers are unchanged.
See [running test assignment evidence](../../audits/distributor-lifecycle/running-model-transfer/README.md).

Distributor activation is organization-wide. Only COMPANY OWNER/ADMIN can call
`PATCH /api/network/distributors/:distributorId/status` with `{isActive: boolean}`.
The independent additive status migration defaults all existing organizations to
active. Deactivation increments the access version and marks every member's
refresh session revoked under an organization row lock shared with login/refresh.
Deactivation must delete no records, including session records. Every
authenticated request checks current access; inactive Distributors receive 403,
and old access tokens remain invalid after reactivation. Reactivation requires a
fresh login; membership approval, roles, kiosks and commercial history are retained.
The frontend shows status/control confirmations and polls Distributor identity
every 30 seconds while open. Logout stays available without an access gate.
On an older database without this migration, legacy access reads remain compatible
and status writes return 503; the UI disables status controls. The configured
database now has the status migration and its controls are enabled. See
[status implementation and deployment state](../../audits/distributor-lifecycle/DISTRIBUTOR_STATUS.md).

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

### Company internal invitations (2026-10-05)

Settings generates internal invitations through the existing Company OWNER/ADMIN
`POST /api/members/generateInviteCode` endpoint with `{role: ADMIN|MANAGER|STAFF}`.
Only OWNER can invite ADMIN; ADMIN can invite MANAGER/STAFF. The Company role is
the existing singleton root organization, not a match on its display name.
The exact ten-character code stores its role prefix and random suffix in the
existing `Organization.inviteCode` field; no schema change is needed. Prefix
tampering fails the exact lookup. Generation replaces the organization's prior
invite. Internal codes expire in seven days and are consumed once under an
organization row lock. Code consumption, user creation and ACTIVE membership
creation commit together. The client cannot select a different organization/role.
`POST /api/auth/join` returns the membership status/role and existing auth cookies.
Unprefixed legacy codes keep PENDING approval behavior, and no-role generation
keeps the existing Distributor invitation flow. Internal codes cannot register
a Distributor. Codes remain absent from `/api/auth/me` and routine responses.
159 isolated auth/invitation checks passed, including existing Distributor/Partner
flows, concurrent consumption and older-schema compatibility. No remote accounts
or emails were created for these tests. Prisma schema fields were not edited.

A User has at most one Membership (`userId` is unique). Membership must be ACTIVE
for protected organization operations; PENDING/REJECTED cannot mutate lifecycle
data. Roles are OWNER > ADMIN > MANAGER > STAFF. Types are COMPANY, DISTRIBUTOR,
PARTNER. Organization registration creates owner, organization, active owner
membership and credential-delivery job in one transaction; it does not switch
the creator's login session.

Distributor registration additionally requires a nonblank `inviteCode` (maximum
10 characters) from the authenticated Company. It reuses the code generated by
`POST /api/members/generateInviteCode`; code, Company ID/type and expiry are
validated in an atomic conditional update before creating any records. Success
clears the code and expiry in the registration transaction, so it cannot be
reused. Failed creation rolls consumption back. Invalid, expired, consumed or
wrong-Company codes return 400. Existing null-expiry codes retain the join flow's
non-expiring semantics. Partner registration and Company join logic are unchanged;
generate a new code after a Distributor consumes the current Company invite.
Invite generation explicitly selects only the stored code and expiry, so it
also works on the configured database without GST/phone/country profile columns.
Returning the entire Organization from this update causes Prisma P2022 and HTTP
500 on that schema. No migration is needed for invite generation itself.

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

The Orders frontend lists real orders only, including completed deliveries;
standalone assignments with no order do not become synthetic orders. The list
returns safe organization references (`id`, `name`, `type`). `GET /api/orders/:orderId`
validates a UUID and scopes access to an active member of either original order
party, returning 404 otherwise. Linked kiosks expose only id, machine code, model
and current status; visibility does not depend on current kiosk ownership.
See [Orders view verification](../../audits/distributor-lifecycle/ORDERS_VIEW.md).

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

F13 browser UI lifecycle was outside the original backend fix. Order rejection
now has the restricted transition described above; FAILED/REFUNDED payments
still have no dedicated transition handlers. Existing
refresh-token expiry discrepancies were not changed. The Distributor status work
adds unique refresh JWT IDs and checks revoked state to prevent old session reuse.
Password changes still verify the supplied
email/password; they were not redesigned around authenticated user ID.

Run from repo root against isolated test databases:

```powershell
npx.cmd tsc --noEmit -p apps/api/tsconfig.json
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/migration-upgrade.ts
```

Main regression defaults to `happy,fixes,distributor_invites,invite_generation_compat`, captures email in memory and fails on
unexpected results. The old negative/concurrency/integrity audit phases reproduce
historical defects and should not be treated as post-fix expectations. See
FIXES.md for exact evidence and explicit read-only preflight command.

The `distributor_invites` phase covers valid OWNER/ADMIN registration, missing,
invalid, expired, consumed and wrong-Company codes, permissions, rollback,
concurrent consumption and unchanged Partner/join flows. Its second-Company
adversarial fixture temporarily relaxes the single-Company index only in the new
local audit database, then restores it; application schema constraints are unchanged.
`invite_generation_compat` checks code generation, rotation, expiry and permission
gates with and without the profile columns, restoring renamed test columns afterward.

For schema changes validate Prisma, inspect the new migration and data impact,
then regenerate via Prisma CLI. Do not reset a database as validation. The current
`npm test` remains a placeholder; documentation-only edits need no runtime tests.


## Vercel deployment (2026-10-07)

The API is deployable to Vercel as a single serverless Function. Three things had to change
first, and each is a real constraint rather than a preference.

**tsconfig path aliases do not survive Vercel's function bundler.** Nine files import runtime
Zod values from `@shared-types/*`, resolved only through the `paths` alias into
`../../packages/shared-types`. That directory sits outside the API project, is not uploaded,
and has no `package.json`, so it cannot be installed either. `scripts/build-vercel.mjs`
bundles `api/index.ts` with esbuild (which does honour the alias) so first-party code is
inlined and the alias stops existing at runtime. npm packages and the generated Prisma client
stay external. Never remove that step from `build:vercel`; without it the function fails to
resolve `@shared-types` at runtime.

**`fs.mkdirSync` at module load is fatal on Vercel.** The filesystem is read-only except
`/tmp`, so the import-time directory creation in `invoice.pdf.ts` killed the function before
it could serve anything. It is now deferred to the first invoice write, and `INVOICES_DIR`
defaults to `/tmp/invoices` when `VERCEL` is set. `revenue.pdf.ts` mirrors this with
`/tmp/reports`. `config/env.ts` throws on invalid configuration instead of calling
`process.exit(1)`, which would end a serverless invocation with no diagnosis.

Local development is untouched: `server.ts`, `npm run dev` and the `invoices/` path behave
exactly as before whenever `VERCEL` is unset.

**Worker.** `revenue.worker.ts` is a long-lived BullMQ process and cannot run on Vercel. Keep
`REVENUE_JOBS_ENABLED` unset there.

Environment: `DATABASE_URL` uses the pooler on port 6543; `DIRECT_URL` uses 5432 for
migrations. `pg` v9 changed SSL semantics, so a bare `sslmode=require` fails with `P1011`;
append `uselibpqcompat=true`. `NODE_ENV=production` activates the strict branch of
`config/env.ts`, making every variable there mandatory.

Invoices and revenue PDFs do **not** persist on Vercel because `/tmp` is per-invocation;
`GET /api/orders/:id/invoice` will 404 after the fact until object storage is added.

Verification lives in `audits/deploy/` and the full runbook in `audits/deploy/README.md`:
`verify-vercel-bundle.mjs` (8/8) proves the bundle boots outside the project, and
`verify-api-against-supabase.mjs` (7/7) proves the production server reaches Supabase,
authenticates the seeded owner and starts no worker.

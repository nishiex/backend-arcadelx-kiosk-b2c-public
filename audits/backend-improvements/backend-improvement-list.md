# Backend improvement backlog — deep code audit

Audited 2026-10-09 against the working tree (`apps/api`, branch `Frontend-Backend-Merge`,
HEAD `c254603`). Every item below cites the file and line it was verified in. No files were
modified and no database changes were made.

Severity key: **P0** = exploitable or actively wrong in production · **P1** = breaks under
real usage · **P2** = maintainability / operability debt.

---

## P0 — Security and correctness

### 1. `POST /api/auth/change-password` requires no authentication
`apps/api/src/routes/auth.routes.ts:50` mounts `changePassword` behind `requireAuth` alone,
but the handler at `apps/api/src/controllers/auth.controller.ts:462` takes `email` from the
request body and looks the user up by that email — it never uses `req.user.id`. A session
for account A can therefore change account B's password **if it knows B's current password**.

The `requireAuth` gate is misleading: it is not enforcing identity here, only presence of a
session. Fix: derive the user from `req.user!.id`, drop `email` from `ResetPasswordSchema`,
and keep `requireAuth` as the sole identity source.

### 2. No rate limiting anywhere, including login
`express-rate-limit` is not installed. `POST /api/auth/login`
(`auth.controller.ts:323`) is unthrottled, as are `/forgot-password`, `/verify-reset-otp`,
and `/reset-password`. The only brute-force protection in the codebase is the 5-attempt cap
on a *single* OTP record (`auth.controller.ts` verifyResetOtp), which an attacker resets by
requesting a new OTP.

Also: `login` returns the same 401 for unknown email and wrong password, and the
`user not found` path returns before any bcrypt work — so response timing distinguishes the
two cases. Add a dummy `bcrypt.compare` on the miss path.

### 3. Outbound email is not idempotent — duplicate invoices and credentials are possible
`attemptDelivery` (`services/email/delivery.service.ts:184`) claims a lease, sends via
Mailjet, then sets `sentAt`. The comment at line ~180 acknowledges ambiguous acceptance. The
real problem is the call sites: `orders.controller.ts:230` and `:259` (create + approve) and
`auth.controller.ts:177` all call `attemptDelivery` inline and return its boolean to the
client. A user retrying a slow request re-enters the whole path. The recovery branch at
line 237 clears the lease on any throw, so the next call sends again.

Concretely: `queueInvoice` uses `create` (not `upsert`) keyed on `order:<id>:invoice`, so a
re-approve of the same order throws a unique-violation → generic 409. And a duplicate email
is materially a duplicate invoice to a customer.

Fix: make the send idempotent (store the provider message id, or gate on `sentAt` with an
`attempts` ceiling), and have the controller return `202 Accepted` with the delivery state
rather than performing the send inline in the request.

### 4. Credentials email is trusted to `childOrg.owner`
`delivery.service.ts` `deliverInvoice` sends the invoice to `order.childOrg.owner.email`.
That is the *org owner* column, not necessarily the authenticated approver — combined with
item 1 this widens the blast radius. Confirm this is intended.

---

## P1 — Broken under real usage

### 5. Cross-tenant data leak: COMPANY orgs all see each other's fleet
`apps/api/src/controllers/Kiosk/kiosk.controller.ts:109`:
```ts
const query = orgType === "COMPANY" ? {} : { currentOrgId };
```
Every COMPANY sees **every kiosk in the database**, not just its own. `getKioskById` has the
same shape: the authorization wall at line ~137 exempts `COMPANY` entirely. `getDistributors`
(`network.controller.ts`) is explicit that a single-company deployment is assumed — see its
comment "If multi-company tenancy is introduced later, narrow this by NetworkConnection".

This is fine for one company and a breach the moment a second COMPANY row exists. Decide
now: either enforce `currentOrgId`/network scoping, or add a hard guard that refuses to start
when more than one COMPANY row exists.

### 6. Public, unauthenticated enumeration of every distributor
`GET /api/network/distributors` (`network.controller.ts` `getDistributors`) is mounted under
`router.use(requireAuth, loadMembership)` on the network router, so it is authenticated —
but it is **not** gated by `requireOrgType("COMPANY")`. Any PARTNER or DISTRIBUTOR can list
every distributor org with owner name, owner email, GST number, and phone.

The same endpoint has `_req` unused and ignores `PaginationQuerySchema`, so it returns the
whole table unpaginated.

### 7. Login is a user-enumeration oracle upstream
`joinOrganization` (`auth.controller.ts:210`) and `registerOrganization` both answer
`409 "User with this email already exists"` and `409 "User with this contact number already
exists"`. Registration endpoints that confirm existence are a standard enumeration vector.
Consider returning a neutral success and sending the conflict by email.

### 8. Kiosk status transition matrix is unreachable and contradicts the new flow
`kiosk.controller.ts` `updateKioskStatus` defines:
```ts
AVAILABLE: ["INSTALLED", "MAINTENANCE", "RETIRED"],
```
`RETIRED` is in the transition table and in `UpdateKioskStatusSchema`
(`packages/shared-types/validationSchemas/Kiosk/kiosk.validation.ts`), but on the `Backend`
branch the `RETIRED` enum value and this whole controller were **removed**. The two branches
disagree about whether this endpoint exists at all. Pick one story:
- keep `PATCH /kiosks/:id/status` → then `RETIRED` must stay in the enum; or
- remove it → then the frontend call at `apps/web/next-monorepo/apps/web/lib/backend-api.ts:547`
  is dead and must be removed too.

### 9. `DELETE /api/network/:connectionId` hard-deletes but the branch adds a soft-delete column
`network.controller.ts` `deleteConnection` calls `tx.networkConnection.delete`. The `Backend`
branch adds `NetworkConnection.deletedAt` and switched to soft deletion. Hard delete is also
what makes "Cannot delete a connection with agreement history" necessary. Port the soft
delete and stop destroying rows that revenue attribution reads.

Only the **initiator** may delete (`initiatorOrgId: currentOrgId`); the receiver cannot
sever a connection. Confirm that is intended.

### 10. `deleteConnection` performs a write inside `GET`-style idempotency expectations, but
more importantly `initiateConnection` can be raced
`network.controller.ts` `initiateConnection` does `findFirst` for an existing connection,
then `create`. Two concurrent requests both pass the check and insert duplicates. The
`NetworkConnection_pair_key` unique index added by migration
`20260929100000_protect_distributor_lifecycle` is what actually saves you — but it fails with
a raw P2002 → generic 409 rather than a clear message. Catch and translate it.

### 11. Two writers share the kiosk namespace without coordination
`batchCreateKiosks` (`kiosk.controller.ts:56`) mints `ADLX-<year>-A<nnn>` from
`MachineSequence`, while `deviceSync.service.ts` registers hardware under its own device id.
`services/machine-code-sequence.ts` exists specifically to push the counter floor, and the
`AGENTS.md` note describes the 409 this caused. The sync-side fix is applied
(`GREATEST(value, floor)`) — verify the ordering is still enforced in
`revenue.worker.ts:26` where `syncDevices` must run before `syncRevenueData`.

On the `Backend` branch this whole area was rewritten again ("transaction based Kiosk
creation"), so this needs re-verification after the merge.

### 12. Hardcoded GST diverges from the configurable rate
`apps/api/src/controllers/Orders/orders.controller.ts:194`:
```ts
const taxAmount = Math.round(totalNonRefundable * 18) / 100;
```
18 is hardcoded, and `apps/api/src/services/pdf/invoice.pdf.ts:136-140` prints
`'18% GST applies to the non-refundable fee only.'` and `'GST (18%)'` as literals.

Meanwhile `services/Revenue/revenueStatement.service.ts:45` reads
`settings?.gstPercentage ?? 18` from `SystemSettings`, and
`controllers/Revenue/revenue.controller.ts` exposes `PATCH /api/revenue/deduction-rates` for
COMPANY OWNER/ADMIN to change GST, PG fee, and TDS.

So an admin can change GST to 12% and **every new order invoice will still charge and print
18%**, while revenue statements use 12%. That is a billing defect. Both the tax computation
and the PDF labels must read `SystemSettings`.

### 13. Orders list is unpaginated
`orders.controller.ts:441` `getOrderRequests` returns every order the org is a party to, with
no `take`/cursor. `OrderQuerySchema` already validates `status`/`type`, so adding pagination
is mechanical. Same shape in several of the 20 `findMany` sites.

### 14. Access tokens survive member removal, role change, and org re-assignment
`refresh` (`auth.controller.ts:371`) and `login` revoke sessions only for DISTRIBUTOR
deactivation via `organizationAccessVersion` (`middlewares/auth.ts:44`). But
`removeMember` (`controllers/membership.controller.ts`) deletes the `Membership` row without
revoking that user's refresh tokens or bumping any version. `loadMembership`
(`middlewares/auth.ts:60`) will start 403-ing them on the next request, so the window is
bounded by the 15-minute access-token TTL — but the refresh token is still live and the user
can keep calling `/api/auth/refresh`.

Fix: on membership delete or role change, `deleteMany` that user's `RefreshToken` rows.

### 15. A rejected join request still hands out a working session
`joinOrganization` (`auth.controller.ts:210`) creates a `PENDING` membership for the legacy
6-char invite path, then unconditionally mints and stores a refresh token and sets cookies.
A pending user has a valid session that only fails at `loadMembership`. Rejecting the request
does not revoke it. Issue tokens only when the membership is `ACTIVE`.

### 16. The `contact` field is written nowhere and validated three different ways
- Schema: `User.contact String? @unique @db.VarChar(10)` (nullable).
- `registerOrganization` validates `ownerContact` as a 10-digit string and checks uniqueness.
- `joinOrganization` requires only `"contact": z.string().trim().min(1)` and **never writes
  it** — `tx.user.create` passes only `name`, `email`, `passwordHash`. Verified in
  `packages/shared-types/validationSchemas/auth.validation.ts` (`JoinOrgSchema` has no
  `contact` field at all; `registerOrganization`'s schema does).

So a user can join, have `contact` NULL, and the `registration` path simultaneously requires
it. Decide whether contact is required and enforce it in one place.

---

## P2 — Operability and maintainability

### 17. Deploys never run migrations
`vercel.json` `buildCommand` runs `prisma generate` + `scripts/build-vercel.mjs`.
`prisma migrate deploy` appears only as the `db:migrate` script, which nothing calls. Add it
as an explicit release step or into the build, and make it fail loudly.

### 18. Rate of stray `process.env` reads that bypass validated config
`config/env.ts` does real zod validation with a stricter production schema, then ~24 sites
read the raw environment instead:
`middlewares/auth.ts:25` (`ACCESS_SECRET_TOKEN`), `utils/db.ts:8` (`DATABASE_URL!`),
`services/email/email.service.ts:6-7` (Mailjet keys via `!`), `services/pdf/revenue.pdf.ts:7`,
`services/Revenue/deviceSync.service.ts:55`, `.../revenueTransaction.services.ts:23`, plus
`REDIS_URL` and `MOTHERSHIP_*`.

Consequence: `email.service.ts` builds the Mailjet client at module load with `!`-asserted
keys, which is why dummy keys are required to boot. A lazy client built from `env` removes
the root cause.

### 19. No graceful shutdown outside the jobs path
`server.ts:10` registers `SIGINT`/`SIGTERM` handlers **only** when
`REVENUE_JOBS_ENABLED === 'true'`. Otherwise there is no shutdown handler and no
`prisma.$disconnect()`.

### 20. Logging is ad-hoc and uncorrelated
8 `console.*` calls total, no request id, no structured logger. `pino-pretty` is declared but
`pino`/`pino-http` are not installed and nothing imports them. `errorHandler` logs a 6-frame
stack with no way to tie it to a request.

### 21. Error handler collapses every Prisma conflict into one opaque 409
`utils/errorHandler.ts` maps `P2002/P2003/P2004/P2034` to a single generic message with
`errors: null`. The client cannot distinguish "duplicate GST number" from "stale write".
Surface `err.meta.target`.

### 22. Dead and inconsistent dependencies
- `node-cron` is declared and used **0 times** — BullMQ owns scheduling.
- `cookie-parser` is declared in `devDependencies` on the `Backend` branch but imported at
  runtime by `app.ts:8`.
- `pino-pretty` declared, unused.
- `"postinstall": "prisma skills sync || exit 0"` — the installed Prisma CLI has no `skills`
  command (verified: `generate`, `db`, `migrate`, `studio`, `validate`, `complete`). It fails
  every install and `|| exit 0` hides it.
- `packages/shared-types` has **no `package.json`** despite `workspaces: ["packages/*"]`. It
  resolves only via the `@shared-types/*` tsconfig path alias, which is exactly why its
  deletion on the `Frontend` branch broke the API build silently.

### 23. CORS and cookies are not configured for a cross-origin deploy
`app.ts:23` is `app.use(cors())` with no options — emits `Access-Control-Allow-Origin: *` and
no `credentials: true`, so browsers reject credentialed requests. Meanwhile
`utils/token.ts` sets `sameSite: 'strict'`, which also blocks cross-site cookies.

The local setup hides this behind the Next.js same-origin rewrite. On Vercel, frontend and
API are different origins, so auth breaks. Set an explicit origin allowlist and `credentials`,
and choose `sameSite: 'none'` + `secure` (or keep a same-site proxy in production).

### 24. No tests and no CI
Zero test files, no `.github/workflows`. There are 28 `$transaction` call sites and raw SQL
with `FOR UPDATE` / `SKIP LOCKED` across orders, kiosk, network, and agreement — code where a
regression is silent and expensive. A CI job that boots the DB from migrations and runs
`tsc --noEmit` would have caught the `Transaction`/`RevenueStatement` duplicate-DDL collision
documented in `audits/branch-compare/Backend-vs-Frontend-Backend-Merge.md`.

### 25. Runtime DDL probing should be removed once migrations are applied
`services/workflow-readiness.ts` probes `information_schema` on every order decision, and
`getDistributors` probes `information_schema.columns` to decide which select fields are
available (`select: { gstNumber: availableProfileColumns.has("gstNumber"), ... }`).
`organization-access.ts` reads `isActive`/`accessVersion` out of `to_jsonb(o)` rather than the
columns. These are migration-window shims; they cost a query per request and mask drift.
Delete them after the merge lands.

### 26. Revenue cron targets PARTNER orgs that can never have a statement
`revenue.worker.ts:32` enqueues monthly statements for `type IN ('DISTRIBUTOR','PARTNER')`.
`getUserOrganizationAccess`/`assertOrganizationActive` only enforces `isActive` for
DISTRIBUTOR, and revenue statements are built from agreement share splits. Verify PARTNER is
actually supported before generating statements for every partner org.

### 27. `REVENUE_REPORTS_DIR` is validated in two places with different rules
`services/pdf/revenue.pdf.ts:9` throws at module load when production + jobs enabled and the
path is missing/relative. `config/env.ts` does not include `REVENUE_REPORTS_DIR` in the
production schema at all (only `INVOICES_DIR`). Consolidate into `env.ts`.

### 28. No reproducible local database
There is no `docker-compose.yml`; the DB exists only as a documented `docker run` one-liner,
and `.env.example` does not mention port 5433. `.env` accepts anything because
`z.string().url()` passes for a malformed URL — see the next item.

### 29. `DATABASE_URL` / `DIRECT_URL` validation accepts malformed values
`config/env.ts` uses `z.string().url()`. I observed this accept a doubled scheme
(`postgresql://postgres://...@localhost:5433/arcadelx_local`) as valid. Use a
`postgresql://`-prefixed refine plus a connection attempt at boot.

### 30. Minor consistency
- `getInventorySummary` (`kiosk.controller.ts`) groups by `currentOrgId` (correctly scoped)
  while its sibling `getKiosks` does not — the two disagree.
- `getOrderInvoice` gates on `fs.existsSync` but then re-renders the PDF from DB data and
  never reads the file, so the `ENOENT`-style 404 is spurious work on a serverless
  filesystem (`INVOICES_DIR` resolves to `/tmp/invoices` when `process.env.VERCEL` is set).
- `RevenueQuery`/`SettingsSchema` live in `@shared-types` but `UpdateKioskStatusSchema` is
  used by a controller the other branch deleted.

---

## Suggested order of work

1. Items **1, 2, 3** — auth identity, rate limiting, email idempotency. All three are
   reachable today.
2. Items **5, 6, 12** — tenancy scoping, distributor exposure, hardcoded GST. These are
   either data leaks or wrong money.
3. Items **17, 23, 24** — migration-on-deploy, CORS/cookies, CI. These prevent the next
   outage rather than fixing the last one.
4. Items **14, 15, 16** — session revocation and the contact field.
5. The rest as part of the branch merge, since several (8, 9, 11, 25) are entangled with it.

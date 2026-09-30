# Distributor activation and login access

Implemented and tested 2026-09-29. **Enabled on the configured Supabase database**
after the user requested fixing the disabled control. Only the independent status
migration was applied, at 12:15 UTC, then recorded with `prisma migrate resolve`.
Both existing Distributors remain active. The live button and confirmation dialog
are enabled; the deployment did not deactivate any account.

## Behavior

- Company OWNER/ADMIN can activate or deactivate a Distributor. Company MANAGER
  and STAFF can read status but cannot change it. Distributor/Partner accounts
  cannot change status, including their own; API authorization enforces this.
- Status belongs to the Distributor organization, covering every member. An
  inactive Distributor cannot log in, refresh a session or use any authenticated
  API route. Correct credentials return an inactive-account message; incorrect
  passwords retain the generic invalid-credentials response.
- Deactivation marks all member refresh tokens revoked, retaining the records,
  and increments an organization
  access version. Old access tokens remain invalid even after reactivation. Login,
  refresh and status changes serialize on the organization row. Refresh JWT IDs
  are unique, preventing same-second login from recreating an old refresh token.
- Reactivation allows a fresh login with existing credentials. It does not approve
  pending members, change roles, move machines, close assignments, terminate
  agreements or alter orders. Logout remains available while inactive.
- The Distributors table shows Active/Inactive badges and an Activate/Deactivate
  action for Company owners/admins. The action asks for confirmation, handles
  pending/error states and refreshes the list after success. An open Distributor
  dashboard checks identity every 30 seconds in the foreground and redirects to
  login when access fails; server enforcement applies on each request.

## Schema and deployment

[Migration](../../apps/api/prisma/migrations/20260929123000_distributor_access_status/migration.sql)
adds two Organization columns: `isActive BOOLEAN NOT NULL DEFAULT true` and
`accessVersion INTEGER NOT NULL DEFAULT 0`. Checks prohibit negative versions and
inactivation of non-Distributor organizations. Existing organizations remain active.

This migration is independent of the earlier lifecycle migration and its legacy
20-kiosk-order blocker. Do not run a broad `migrate deploy` against the configured
database while that earlier blocker remains. If explicitly authorized, apply only
this reviewed status SQL in a transaction and record this exact migration as
applied using Prisma's migration tooling. Do not mark the unrelated lifecycle
migration applied. Normal fresh-database deployments use the migration chain.

Before deployment, access reads use JSON field extraction with the original
active/version-zero defaults when the new columns are absent. No status state is
cached. The list reports `statusManagementAvailable: false` and the write endpoint
returns 503 until both columns exist. SQL/query failures are not treated as active
access. This compatibility supports the already partially migrated running DB.

The initial read-only preflight confirmed both columns and this migration record
were absent. Deployment added only the two reviewed columns and constraints, then
recorded this migration. Before/after organization fingerprints excluding the new
columns match; all four organizations remain active at access version zero.
There are one Company, two Distributors and one Partner. No user, session, kiosk,
order, agreement or assignment was changed. The earlier lifecycle migration and
its business-data blockers remain unresolved. See
[deployment evidence](distributor-status-deployment.json).

## Verification

- Data-retention follow-up: deactivation uses `refreshToken.updateMany` with
  `revoked: true`, never deletion. The regression compares all session records
  before/after (allowing only the revoked flag), full user records, organization
  profile fields, memberships and business history. The running API reloaded this
  change without a schema migration or remote test-data mutation.
  [Retention rerun](20260929121828960/evidence.json): 92 requests, 26 assertions,
  zero mismatches; backend typecheck also passed.
- API TypeScript, frontend typecheck and Prisma schema validation passed.
- Frontend lint: zero errors, 62 existing warnings. Diff whitespace checks passed.
- [Status HTTP/browser run](20260929120912488/evidence.json): 92 requests,
  23 assertions, zero mismatches. Covers role/type gates, strict validation,
  default status, idempotency, all-member revocation, blocked login/API/refresh,
  old-token rejection after reactivation, unchanged memberships/business data,
  concurrent login/refresh against deactivation, UI confirmation/cancel, inactive
  badges, login message, open-dashboard redirect and reactivation. Light/dark and
  mobile dialog screenshots were visually reviewed.
- The isolated test also removed only the new columns in its disposable database,
  verified legacy reads and refused writes, then reapplied the additive migration
  to populated data. Existing organizations became active and business rows were
  unchanged. No existing database was reset or reseeded.
- Full `happy,fixes` suite rerun:
  [20260929121006343](20260929121006343/evidence.json): 289 requests,
  71 assertions, zero mismatches, including the
  Company → Distributor → Partner lifecycle and F1–F11/R1–R9 checks.
- A separate GET-only live browser check confirmed both real Distributors still
  load and controls are disabled with the database-update message until migration.
  Screenshot: `%TEMP%/arcadelx-distributor-status/live-awaiting-migration.png`.
- After deployment, a GET-only live browser check confirmed the Deactivate button
  is enabled, opens its confirmation dialog, and Cancel closes it. No status PATCH
  was sent during this check. Screenshot:
  `%TEMP%/arcadelx-distributor-status/live-controls-enabled.png`.

Reproduce with the local frontend running on port 3000:

```powershell
$env:AUDIT_PHASES='distributor_status'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

The harness uses a fresh local Docker database and captures all email. Its browser
requests are forwarded to those actual isolated HTTP handlers. The configured
Supabase schema is inspected read-only; no production mutation tests are run.

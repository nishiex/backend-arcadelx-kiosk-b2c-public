# Distributor lifecycle: F1–F11 fixes

Verified 2026-09-29 against the current backend and shared validation code.
F1–F11 are implemented and pass the isolated HTTP/database regression. These
changes have **not** been deployed to the configured Supabase database.

## What changed, one finding at a time

| Finding | Implemented behavior | Verification |
| --- | --- | --- |
| F1 — role bypasses | Organization registration and kiosk mutations require OWNER/ADMIN as well as the existing organization-type and active-membership gates. Both new retry endpoints use the same gates. Agreement owner-only permissions remain. | Unauthenticated, pending/rejected membership, MANAGER/STAFF, wrong-type and wrong-organization requests are rejected. Authorized OWNER/ADMIN paths pass. |
| F2 — agreement/network bypass | Creation and approval require an ACTIVE connection whose initiator and receiver exactly match the proposed parent and child. Allowed hierarchy is COMPANY → DISTRIBUTOR/PARTNER or DISTRIBUTOR → PARTNER. Order creation rechecks the relationship; order transitions reject inconsistent legacy relationships. | Self, unrelated-network, mismatched-endpoint and invalid-type requests fail; the valid transfer chain passes. |
| F3 — duplicate agreements | A transaction locks the child organization and checks pending/active conflicts at creation and approval. A Partner cannot have competing pending/active Distributor agreements. A partial unique index protects each parent/child pair. | Sequential duplicates and overlapping draft/approval requests are rejected without duplicate open agreements. |
| F4 — manual kiosk state bypass | RESERVED and ASSIGNED are controlled by orders. Manual status changes cannot enter or leave these states or alter a reserved kiosk. Other status changes follow an explicit transition table; RETIRED is terminal. Each reserved kiosk points to its current order. | Manual release/re-reservation fails with 409, subsequent allocation cannot reuse the stock, and the database rejects an orphan reservation state. |
| F5 — stale ownership transfer | Approval, dispatch and delivery lock order/stock rows. Dispatch/delivery validate quantity, owner, state and reservation pointer inside the transaction. Delivery also validates the open assignment owner, closes history, transfers ownership and clears the reservation atomically. | An intentionally stale-owner fixture returns 409 with unchanged history; valid delivery succeeds; repeat/concurrent delivery cannot add a second active assignment. |
| F6 — email-failure recovery | Credentials/invoice delivery is queued in the business transaction. A failed email or PDF attempt leaves a successful committed business response with explicit delivery flags. Owner-scoped retry endpoints recover the same operation. Credential payloads are encrypted and erased after successful delivery. | Injected credential-email, invoice-email and PDF failures recover without duplicate organization/order/stock or password rotation. Concurrent retry and already-sent retry do not resend in the tested cases. Wrong organization is rejected. |
| F7 — invoice URL | Persisted and returned URLs use `/api/orders/:id/invoice`; order responses reload generated metadata. Migration repairs old `/orders/.../invoice` URLs. | The URL returned by the API downloads a PDF. Migration backfill preserves the order. |
| F8 — fractional truncation | Agreement amounts must be whole currency units from 0 through 2147483647, matching the existing PostgreSQL Int columns. Fractional values are rejected, never silently truncated. | Fractional, negative and out-of-range amounts return 400. Integer agreement amounts, financial snapshots and inherited downstream terms pass. |
| F9 — deleting networks with history | Deletion locks the connection and returns 409 if **any** agreement references it, including pending and terminated agreements. History remains intact. | Active, pending and terminated-history cases return 409 without deleting records. |
| F10 — validation/error responses | Zod and malformed-JSON errors return 400. Pagination is bounded; order status/type filters are enums. Unknown invite codes return 404. Database uniqueness/concurrency conflicts return 409; unexpected errors no longer expose internal exception messages. | Invalid body amounts/quantities, pagination and query enum cases return client errors. Existing middleware and organization scoping remain effective. |
| F11 — Distributor profile | Optional validated `gstNumber`, `phone`, and `country` columns are saved during registration and returned by the Distributor list. | Provided values round-trip exactly; oversized input is rejected. Existing profiles receive NULL without invented data. |

Company shares remain explicitly supplied; Distributor → Partner shares remain
60/40 with amounts inherited from its active Company agreement. This change does
not redefine F12 termination policy or implement F13 UI lifecycle screens.

## Verification evidence

Final complete run: **[20260929075030579/evidence.json](20260929075030579/evidence.json)**.

- **289 HTTP requests, 71 assertions, zero expectation mismatches**.
- Full Company → Distributor → Partner lifecycle passed using real Express
  handlers and PostgreSQL transactions, including both REQUEST and ALLOCATION.
- R1–R9 concurrency cases passed with database barriers confirming overlap:
  distinct reservations, duplicate approval, unique order numbers, duplicate
  delivery, duplicate connection, duplicate agreement, duplicate acceptance,
  duplicate activation, and delivery racing with manual status changes.
- Email transport was replaced with an in-memory test transport: 18 captured
  messages, zero external email sends. Actual Mailjet delivery was not tested.
- Existing local database row fingerprints were unchanged. Test fixtures and
  invoice files stayed in newly created audit databases/directories.
- Prisma schema validation, generated-client creation, TypeScript no-emit check
  and `git diff --check` passed.

Migration tests: **[migration-20260929075338524.json](migration-20260929075338524.json)**.
Eight cases passed: populated upgrade, duplicate networks, duplicate agreements,
duplicate open history, ambiguous stock, stale owner, incomplete active order,
and orphan reservation. Invalid fixtures cause a complete DDL rollback without
deleting business/history records. A valid upgrade backfills current reservations,
preserves delivered history, initializes per-year order counters and repairs URLs.

An earlier run stopped on a login timeout and exposed a baseline-test assumption
about kiosk ordering when timestamps tie. The assertion now uses the actual
reserved IDs. Two subsequent full runs passed; the final run above includes the
completed migration and formatted application code.

## Migration and configured database status

New migration:
[`20260929100000_protect_distributor_lifecycle`](../../apps/api/prisma/migrations/20260929100000_protect_distributor_lifecycle/migration.sql).
Historical migrations were not rewritten, and no existing database was reset.

The **[read-only configured-database preflight](preflight-20260929074928918.json)**
found one APPROVED/DISPATCHED order whose linked kiosk count does not match its
quantity. All eleven other inspected conflict counts were zero. The migration
deliberately refuses this inconsistent state. The affected order needs an explicit
business reconciliation; this change does not invent stock, delete its history,
or silently mark it delivered.

The configured database also has two migrations absent from this checkout:

- `20260928063729_implement_transactions_schema`
- `20260928073023_remove_payu_retries`

Their source must be reconciled with the checkout before deployment. The current
root environment targets that database; the existing Docker `arcadelx` database
has only six old migrations. Neither is a prepared runtime for this updated
Prisma client. Use a fully migrated database before running the updated application;
simple health checks do not prove the feature schema is compatible.

After reconciling history and the affected order, rerun the read-only preflight,
review the intended target, apply the new migration through the normal deployment
process, generate the Prisma client, and restart the API. No remote deployment
or data repair was performed in this task.

## Recovery endpoints and operational behavior

- `POST /api/auth/organizations/:organizationId/credentials/retry`
- `POST /api/orders/:orderId/invoice/retry`

Both require an active COMPANY/DISTRIBUTOR OWNER or ADMIN in the organization
that created the queued delivery. They return 200 when sent/already sent or 202
when delivery remains pending. Registration returns `credentialsEmailSent`;
allocation/approval/retry returns `invoiceEmailSent` and `invoiceReady`.

Retries are explicit; there is no automatic background worker or new UI retry
button in this backend-only change. Jobs persist across process restarts. Keep
`INTERNAL_API_SECRET` stable while credential jobs are pending because it derives
their encryption key. A crashed attempt becomes retryable after its two-minute
lease expires. Provider acceptance followed by a lost acknowledgement can still
cause duplicate email on retry; it cannot duplicate business records.

## Repeat the tests

From the repository root, with Docker `arcadelx-pg` available on localhost:5433:

```powershell
npx.cmd tsc --noEmit -p apps/api/tsconfig.json
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/migration-upgrade.ts
```

The main harness defaults to `happy,fixes`, creates a new local database for each
run, and exits nonzero on expectation mismatches. `AUDIT_PHASES` can select phases.
The older `negative,concurrency,integrity` phases are historical defect
reproductions and contain expectations for the unfixed implementation.

The configured database is inspected only when explicitly requested:

```powershell
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/migration-preflight.ts --configured-readonly
```

Original findings remain in [REPORT.md](REPORT.md); they describe the pre-fix
implementation. This file records the verified behavior after F1–F11 changes.

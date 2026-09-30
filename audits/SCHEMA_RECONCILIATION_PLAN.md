# Supabase reconciliation status — 30 September 2026

**The order-data blocker is resolved, and request rejection is enabled. The two historical migration sources remain missing.** The user-selected repair returned the inconsistent order to UNDER_REVIEW. On 30 September the independently reviewed rejection-enum migration was applied and registered with Prisma; the order lifecycle migration remains unapplied. [Rejection deployment](REQUEST_REJECTION_DEPLOYMENT.md).

Read-only evidence: [schema-reconciliation.json](distributor-lifecycle/schema-reconciliation.json) and [latest preflight](distributor-lifecycle/preflight-20260930080434742.json). All twelve integrity counts are zero; no failed migration exists.

## Migration history

All nine older local migration files match their recorded database checksums after CRLF-to-LF normalization. The separately applied distributor-status and request-rejection migrations match exactly. Those differences were Windows line endings, not changed SQL.

`20260929100000_protect_distributor_lifecycle` is absent from the applied history and is the source of the missing `Kiosk.reservedOrderId`, `EmailDelivery`, `OrderSequence`, Organization profile columns and lifecycle constraints.

Two database-applied migrations are still absent from the checkout:

| Name | Recorded SHA256 |
| --- | --- |
| `20260928063729_implement_transactions_schema` | `6b2453ea6f7f938eecb8c8be18687744995a4aa0a6ddc82f6f75047bb9e2f6a3` |
| `20260928073023_remove_payu_retries` | `2629cb11a8df9c247a0e8e0a334a3cdb976adf8d848d1188e2cf03e0d7840d49` |

The expanded search checked three Git repositories (including reflogs/unreachable blobs), SQL files under the user profile, VS Code SQL history and downloaded/cleanup ZIP archives. None of 102 candidate hashes matched. [Expanded recovery evidence](distributor-lifecycle/migration-source-recovery-expanded.json). Nine older SQL files in the OneDrive checkout were unreadable; neither missing migration filename was present there. GitHub origin branches were fetched again; the repository has no available Actions artifacts, releases, deployments, forks or pull requests containing another source. Exact-name GitHub code searches returned no results. The latest fetched Backend commit is dated 23 September, before these migrations were applied on 28 September.

PostgreSQL's Prisma history stores checksums, not the original SQL. An equivalent script must not be fabricated and represented as the original migration. No replacement migration files or history changes were made. The user has been asked for the developer/deployment checkout used on 28 September.

The original SQL is still needed from the deployment checkout, its author, a repository containing it, or a deployment artifact. Restore it only after matching these hashes. Preserve any additional payment/transaction schema it owns; do not reset the database or delete extra tables to force a Prisma match.

## Completed order repair

Order `ORD-2026-721401-59` (`afd69339-3d50-4fb5-b176-cd0322b1ae79`) was APPROVED for 20 kiosks, payment PENDING, with zero OrderKiosk links and zero assignment records. The user explicitly selected **Return to UNDER_REVIEW for fresh approval**.

The repair was tested in a newly created local database using the exact saved order row and synthetic prerequisite records. The transition and unchanged financial snapshot checks passed, a repeated repair was refused, and the lifecycle migration passed against that local fixture. This was a focused local fixture, not a full production clone. [Preparation evidence](distributor-lifecycle/order-repair-20260930071835762.json).

The authorized remote transaction locked the order and inventory/history tables, required an exact match with the reviewed snapshot, and changed only status and updatedAt. The before/after snapshot was saved before COMMIT. Post-commit verification confirms UNDER_REVIEW, quantity 20 and payment PENDING. Financial amounts, invoice references, all 131 kiosks, three assignment records, agreements, networks and migration history were preserved. [Committed repair evidence](distributor-lifecycle/order-repair-20260930071923982.json). The earlier rollback-only SQL preview remains historical; the executed repair is [repair-existing-order.ts](distributor-lifecycle/harness/repair-existing-order.ts).

An authenticated read through the running frontend proxy (`GET /api/orders`) also returned the repaired status, quantity and payment state; the verification session was logged out. No approval, stock reservation or email send was triggered.

## Deployment sequence after the blockers are resolved

1. Recover the exact two historical migration sources and verify their recorded hashes. Recheck local SQL against migration history with LF normalization.
2. The order repair is completed and snapshotted. Recheck its state and the full preflight immediately before deployment; do not repeat the repair against an already reviewed or newly processed order.
3. Rerun the read-only preflight. All integrity counts must be zero and no unfinished failed migration may remain.
4. Review a schema diff that preserves the additional transaction/payment schema. Apply the pending lifecycle migration through Prisma's deployment process only after the data repair and history reconciliation pass.
5. `20260930070000_request_rejections` is already applied independently after review and a local upgrade/Prisma-registration rehearsal. Preserve its recorded checksum; do not reapply or rewrite it.
6. Verify migration history, schema readiness, API health and a controlled end-to-end acceptance test. Do not claim production verification from the isolated tests alone.

## Running-app behavior while reconciliation is pending

The member decision race and selective join-query fixes do not need schema changes and are available in the running development API. `/user` pagination, role filtering and polling are also live.

Network/agreement rejection is now enabled in Supabase. `/api/workflows` reports true for both rejection capabilities. Eligible pending requests show rejection controls after the page's availability query refreshes. Existing acceptance/approval paths and request-history reads remain available.

Order creation/approval/rejection check required schema first and return HTTP 503 with a user-facing availability message instead of HTTP 500. The Orders UI disables decisions until `/api/workflows` reports readiness. The legacy order is repaired, but schema reconciliation is still pending recovery of the two original migration sources and deployment of the reviewed pending migrations.

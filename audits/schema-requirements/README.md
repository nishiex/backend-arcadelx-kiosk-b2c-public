# Reservation and order-sequence audit — 1 October 2026

Later update: the user lifted the EmailDelivery/Supabase restriction, but the
fresh deployment gate still failed because the two original migration files are
missing. See [current deployment blocker](DEPLOYMENT_BLOCKER.md). The local-only
scope and results below describe the earlier rehearsal.

The reservation and sequence changes passed an isolated PostgreSQL rehearsal. They
have **not** been deployed. No Supabase changes, EmailDelivery DDL, email-delivery
code changes, Prisma model changes, historical migration edits, or readiness guard
changes were made.

## Configured database: read-only findings

[Schema evidence](configured-readonly.json) and the refreshed
[integrity preflight](../distributor-lifecycle/preflight-20261001095041506.json)
were collected inside database-enforced read-only transactions. All twelve
integrity-conflict counts are zero; no failed migration was found.

| Requirement | Current finding | Remaining work |
| --- | --- | --- |
| `Kiosk.reservedOrderId` | Missing | Nullable text column, active-order backfill, restrictive order foreign key and reservation/status check |
| `OrderSequence` | Missing | Integer year primary key and integer value defaulting to zero; backfill canonical yearly order numbers |
| Organization profile | `gstNumber`, `phone`, `country` missing | Additive profile-column deployment remains pending |
| Network integrity | `NetworkConnection_pair_key`, `network_distinct_parties` missing | Canonical pair uniqueness and distinct-party constraint remain pending |
| Agreement integrity | `Agreement_open_pair_key`, `agreement_distinct_parties` missing | Partial open-pair uniqueness and distinct-party constraint remain pending |
| Assignment integrity | `KioskAssignment_one_open_key` missing | Partial uniqueness for open assignments remains pending |
| Invoice URL backfill | No legacy URLs currently match | No current rows require this repair; no URLs changed |

There is one order, with a legacy number outside `ORD-YYYY-digits`, and no active
APPROVED/DISPATCHED reservations. The existing sequence-backfill query therefore
produces no counter rows for the configured data. Its next allocation would start
at 1 for the requested year, formatted by current code as `ORD-YYYY-00001`.
The legacy number is preserved and cannot collide with that canonical format.
This is an audit result, not an instruction to allocate a number in the live DB.

## Local work and verification

[reservation-sequence.preview.sql](reservation-sequence.preview.sql) contains the
unchanged reservation/sequence section extracted from
`20260929100000_protect_distributor_lifecycle`, wrapped in a transaction with locks
on Order, OrderKiosk and Kiosk so the backfill sees stable inputs. It contains no
EmailDelivery operations. This is a **local review artifact**, outside Prisma's
migration directory, not an approved deployment migration.

[rehearse.mjs](rehearse.mjs) creates a new database on the documented local Docker
PostgreSQL server. It does not load `.env` or connect to the configured remote DB.
It bootstraps only migrations preceding the lifecycle migration, rejecting any
bootstrap SQL containing EmailDelivery, and inserts synthetic fixtures. Each case
runs in a transaction and rolls back; the new local fixture database is retained.
Existing local databases are untouched.

Run from the repository root:

```powershell
node audits/schema-requirements/rehearse.mjs
```

Eight cases passed; [results](local-rehearsal.json): valid approved/dispatched
reservations and yearly counters, incomplete active orders, ambiguous reservations,
wrong owners, wrong stock status, orphan reservations, integer counter overflow,
and legacy-only numbering. Verification includes:

- Exact reservation backfills; delivered stock remains unreserved.
- Per-year maximum counter backfills and consecutive allocations.
- Foreign-key and reservation-state constraint rejection.
- Preservation of business rows, financial amounts, invoice references and history.
- Complete DDL/data rollback after each case, including failed migrations.
- EmailDelivery remains absent throughout; the actual unchanged readiness query
  still reports `orderDecisions: false` after the other two requirements exist.

API TypeScript checking and harness JavaScript syntax checking also passed. These
are isolated schema checks, not a live order lifecycle or email integration test.

## Deferred EmailDelivery blocker

EmailDelivery and all related schema/code are excluded from this work. Its absence
still blocks `orderDecisions` in the existing backend readiness query, which checks
all three requirements together. Order creation, approval and rejection consequently
remain unavailable, including the frontend Request Kiosks control.

REQUEST creation itself does not enqueue an invoice, but it deliberately shares
the same readiness gate. ALLOCATION creation and approval enqueue an invoice in
their business transaction. No guard was bypassed and no email operation was run.

## Separate deployment blockers

The original files for `20260928063729_implement_transactions_schema` and
`20260928073023_remove_payu_retries` remain missing. The existing
[reconciliation plan](../SCHEMA_RECONCILIATION_PLAN.md) records their required
checksums. This audit neither fabricates those sources nor changes migration history.

The full pending lifecycle migration also creates EmailDelivery and includes the
other missing requirements above. Applying it would violate the current scope.
Applying the preview independently and later running that full migration would
also collide with duplicate column/table creation. Do not mark the full migration
applied after a partial extraction. A future deployment needs a reviewed migration
history and sequencing plan that preserves the original migrations and extra
transaction/payment schema. No such deployment or Prisma registration was attempted.

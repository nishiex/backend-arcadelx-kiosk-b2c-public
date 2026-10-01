# Request Kiosks deployment gate — 1 October 2026

**Deployment stopped before any database changes.** The user has authorized
EmailDelivery and required Supabase schema changes, but explicitly requires
preserving and validating migration history and stopping if the missing originals
prevent a safe deployment. The temporary EmailDelivery restriction is lifted;
the remaining blocker is migration history.

## Current inspection

`npx --no-install prisma migrate status`, run from `apps/api`, exited with code 1
and reported divergent local/database histories:

- Last common migration: `20260922151453_add_invoice_filename`.
- Pending: `20260929100000_protect_distributor_lifecycle`.
- Recorded in the database but absent locally: the two migrations listed below.

[Read-only inspection](deployment-inspection.json) found 13 recorded migrations,
no unfinished failed migrations, and matching recorded checksums for all 11
available applied migrations (the nine older files match after CRLF-to-LF
normalization). No migration files or database history records were rewritten.

The inspection also ran the existing backend readiness SELECT unchanged:

```json
{"networkRejection":true,"agreementRejection":true,"orderDecisions":false}
```

`Kiosk.reservedOrderId`, `OrderSequence`, and `EmailDelivery` are still absent.
The configured schema queries ran inside a repeatable-read, read-only transaction.

## Missing original SQL

| Migration | Required SHA-256 from the database |
| --- | --- |
| `20260928063729_implement_transactions_schema` | `6b2453ea6f7f938eecb8c8be18687744995a4aa0a6ddc82f6f75047bb9e2f6a3` |
| `20260928073023_remove_payu_retries` | `2629cb11a8df9c247a0e8e0a334a3cdb976adf8d848d1188e2cf03e0d7840d49` |

Fetched origin again and checked all available Git history for both names. The
latest origin/Backend commit remains dated 23 September, before their application.
The expanded recovery scan checked three local Git repositories including reflogs
and unreachable objects, local migration files, SQL editor history and relevant
ZIP archives. None of 120 candidate hashes matched either original. Nine older
OneDrive SQL files remained unreadable; neither target migration was found there.
[Recovery evidence](deployment-source-recovery.json).

Retrieve each original `migration.sql` from the developer/deployment checkout or
artifact used on 28 September. Its bytes must match the recorded checksum before
restoring it to the corresponding `apps/api/prisma/migrations/<name>/migration.sql`.
Equivalent replacement SQL, schema-derived reconstructions and migration-history
edits do not satisfy this gate.

## Actions and tests

This attempt added only local inspection/recovery evidence and this report, and
refreshed local remote-tracking Git refs. No application code, readiness guard,
schema, business data, EmailDelivery object, or Prisma history was changed.
No deploy, db push, migration resolve, partial schema application, or reset ran.

Because the required pre-deployment gate failed, the requested post-change API,
component and live workflow tests were not run. In particular, no live order was
created, approved or rejected; no reservation or email-delivery job was created.
Earlier isolated tests are not evidence of a successful Supabase deployment.

After recovering the originals: verify the checksums and migration status, rerun
the integrity preflight, review the schema diff while preserving additional
transaction/payment objects, rehearse and deploy the required migration, verify
history and readiness, then test Request Kiosks, create/approve/reject, reservation
handling, EmailDelivery and OrderSequence. Request Kiosks remains disabled until
the existing readiness guard observes a genuinely ready schema.

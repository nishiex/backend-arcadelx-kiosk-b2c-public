# Prisma drift recovery — 1 October 2026

The reported error is shared Supabase schema/history drift. Do not run
`migrate reset`, `db push`, or mark migrations applied to suppress this error.

## Restore missing migration sources

Copy only missing directories from this bundle's `apps/api/prisma/migrations`
into your checkout's corresponding directory. Keep all your other migrations
and your `schema.prisma`, including SystemSettings / RevenueStatement changes.
If an existing directory differs, compare it; do not overwrite historical SQL.

Bundled unchanged sources:
- `20260929100000_protect_distributor_lifecycle` (commit `9b5ef9a`)
- `20260929123000_distributor_access_status` (commit `e8ba723`)
- `20260930070000_request_rejections` (commit `e8ba723`)

## Generate the feature migration locally

With Docker Desktop running, use PowerShell to create a separate NEW local
database. These commands do not copy or modify Supabase data. The password is
only for this disposable local development database.

```powershell
docker run -d --name arcadelx-migration-dev -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=arcadelx_migration_dev -p 127.0.0.1:55433:5432 postgres:16
cd C:\Users\ABC\Desktop\KioskManagement\apps\api
$env:DATABASE_URL = 'postgresql://postgres:devpass@localhost:55433/arcadelx_migration_dev'
$env:DIRECT_URL = $env:DATABASE_URL
docker exec arcadelx-migration-dev pg_isready -U postgres -d arcadelx_migration_dev
```

Wait for `accepting connections`, then run in the SAME terminal, stopping if
any command fails. Prisma must print localhost:55433 / arcadelx_migration_dev.

```powershell
npx prisma validate
npx prisma migrate deploy
npx prisma migrate dev --name Implement_SystemSettings_RevenueStatement
npx prisma generate
```

These environment overrides last only for this terminal. Set both URLs in your
ignored `.env` too if you want local development to persist in new terminals.
Review generated SQL: unexpected transaction table drops indicate your schema
and intended transaction feature still need alignment. Do not deploy such SQL.

## Supabase reconciliation is still outstanding

The log also says Transaction, RevenueSyncRunLog and SyncStatus are absent from
the actual database despite being expected by your migration history. Restoring
the two missing applied migrations alone cannot fix that discrepancy.
Lifecycle additions are present too; compare the full lifecycle migration,
including constraints and backfills, against schema AND recorded history before
deciding whether to apply or register anything.

Provide your feature's schema.prisma and exact original transaction migrations.
Earlier repository audit notes identify these historical filenames:
- `20260928063729_implement_transactions_schema/migration.sql`
- `20260928073023_remove_payu_retries/migration.sql`

Those sources and your new feature models are absent from this checkout. Back up
Supabase and review a data-preserving reconciliation against the complete team
history before deploying the feature migration. Earlier audit notes are not a
substitute for inspecting the database's current state.

Verification here: current Prisma schema validation passed; bundled SQL matches
the local source files byte for byte. No shared database changes were made.
The teammate-specific feature migration has not been generated or validated here.

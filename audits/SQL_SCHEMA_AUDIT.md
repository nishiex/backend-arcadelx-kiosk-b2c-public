In `audits/SQL_SCHEMA_AUDIT.md`, the SQL that is currently missing from the configured database is mainly contained in:

```text
apps/api/prisma/migrations/20260929100000_protect_distributor_lifecycle/migration.sql
```

Required but not currently deployed:

### Missing columns

```sql
Organization.gstNumber
Organization.phone
Organization.country
Kiosk.reservedOrderId
```

### Missing indexes

```sql
NetworkConnection_pair_key
Agreement_open_pair_key
KioskAssignment_one_open_key
```

### Missing constraints

```sql
network_distinct_parties
agreement_distinct_parties
Kiosk_reservedOrderId_fkey
kiosk_reservation_state
```

### Missing tables

```sql
OrderSequence
EmailDelivery
```

### Missing data repair/backfill operations

The lifecycle migration also performs:

- Order/kiosk consistency validation.
- `Kiosk.reservedOrderId` backfill from `OrderKiosk`.
- Order sequence backfill.
- Invoice URL repair.

Additionally, the database has two migration records whose original SQL files are missing from the repository:

```text
20260928063729_implement_transactions_schema
20260928073023_remove_payu_retries
```

Their exact missing SQL cannot be safely listed because the original migration sources were not recovered. They may contain transaction/payment tables such as `Payment`, `Settlement`, or related objects.

The rejection SQL is **not missing**:

```text
ALTER TYPE "NetworkStatus" ADD VALUE 'REJECTED';
ALTER TYPE "AgreementStatus" ADD VALUE 'REJECTED';
```

That migration is already present and was deployed:

```text
apps/api/prisma/migrations/20260930070000_request_rejections/migration.sql
```

So, in short:

- The checked-in Prisma schema and migration files are internally complete.
- The configured database is missing the lifecycle migration’s SQL changes.
- Two historical migration SQL sources are missing from the repository and must be recovered before deployment.
- No SQL should be fabricated or rewritten until those historical migrations are recovered.
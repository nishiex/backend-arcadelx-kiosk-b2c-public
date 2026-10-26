# ArcadeLX teammate notes

## Latest database migration

The latest checked-in migration is:

`apps/api/prisma/migrations/20261023170000_add_eod_device_price_updates/migration.sql`

It adds end-of-day device price update tracking:

- `EodDevicePriceStatus`: `PENDING`, `PROCESSING`, `APPLIED`, `FAILED`
- `EodDevicePriceUpdate` table
- Unique protection for `deviceId`, `gameId`, and `businessDate`
- Indexes for worker processing and device/game lookups
- Foreign-key ownership through `createdById` → `User.id`

The matching Prisma model is in `apps/api/prisma/schema.prisma`:

`model EodDevicePriceUpdate`

## Prisma verification

Run these commands from `apps/api`:

```powershell
npm.cmd run typecheck
npx.cmd prisma migrate status
```

The expected migration result is:

```text
Database schema is up to date!
```

Prisma uses `DIRECT_URL` for migrations and `DATABASE_URL` for application runtime connections. Keep both values configured for the same database when switching environments.

Do not use `prisma migrate resolve --applied` or `--rolled-back` unless the target database has been inspected first. A failed migration may have data or schema differences that require reconciliation.

## Kiosk assignment flow

Master Admins and Distributors can assign available kiosks to approved direct child organizations.

API endpoint:

```text
POST /api/kiosks/assign
```

The endpoint validates:

- authenticated active membership
- `OWNER` or `ADMIN` role
- correct organization hierarchy
- active agreement with the target organization
- kiosk ownership and availability
- transaction-safe assignment history updates

The operation closes the current `KioskAssignment`, creates a new assignment row, and updates `Kiosk.currentOrgId`.

The frontend flow is in:

`apps/web/next-monorepo/apps/web/components/distributors/DistributorViewMoreDialog.tsx`

Open a distributor, select **Kiosks**, select available machines, and click **Assign**.

## Reporting and audit features

- Machine activity is shown on the dashboard.
- Audit records are available through the audit API and audit-log screen.
- Kiosk assignment history is used for activity and revenue attribution.

## Verification completed

- API TypeScript check passed.
- Frontend TypeScript check passed.
- Prisma migration status reported the database schema as up to date.


# Seed and database persistence

`apps/api/prisma/seed.ts` is a one-time database bootstrap. It creates a User,
Company Organization and ACTIVE OWNER Membership in one PostgreSQL transaction.
It is not imported by the frontend, and changing the seed does not update existing
accounts or company records. The running dashboard, Orders, Kiosks and Members
screens fetch their business records through the backend API.

## Changes

- Owner name/email/password and company name/address/state/city/pincode come from
  `SEED_*` environment settings documented in `.env.example`. Hardcoded login and
  company details were removed from the seed.
- The root `.env` loads before the Prisma client is constructed, independent of
  the working directory. Existing process environment values take precedence.
- A transaction advisory lock serializes simultaneous seed runs. Existing company
  records, user/password values and membership records are never overwritten.
- Existing company checks select only required fields and therefore work without
  the optional profile/access columns. They verify an ACTIVE OWNER membership;
  inconsistent existing ownership is reported for explicit repair.
- New company creation requires the organization access-status columns, whose
  defaults Prisma sends on insertion. Missing configuration or required schema
  fails before any setup records are written.
- Passwords are bcrypt-hashed, never logged, and limited to 72 UTF-8 bytes to
  prevent silent bcrypt truncation. Any creation failure rolls back all three
  records. The seed creates no sample orders, kiosks, payments or invoices.

## Usage

For a new database, apply the reviewed migrations, set the eight `SEED_*` values
in ignored `.env` or deployment environment settings, then run from `apps/api`:

```powershell
npx.cmd prisma db seed
```

Do not run migrations against the configured Supabase database until its separate
history reconciliation is complete. Seeding does not recover historical migration
SQL or apply pending schema changes.

To verify an existing company without writes, run from the repository root:

```powershell
npx.cmd tsx --tsconfig apps/api/tsconfig.json apps/api/prisma/seed.ts --check
```

`--check` uses a database READ ONLY transaction. It succeeds when the saved company
has an ACTIVE OWNER membership; it fails on missing or inconsistent setup.
The configured Supabase database passed this check on 30 September 2026. Its
company ID is `bbba8db6-0e6b-4482-8194-c5d3f7f9bf52`. No remote seed writes,
password changes or schema migrations were performed.

## Verification

[Eleven persistence checks passed](distributor-lifecycle/seed-persistence-20260930074727791.json)
in a newly created local database, including invalid configuration, missing insert
schema, injected membership failure with full rollback, simultaneous seeds,
independent-connection persistence, bcrypt verification, compatibility with absent
optional columns, the actual Prisma CLI command, repeat-run preservation, read-only
checks, inconsistent-owner rejection and real API login reading a database edit.
API TypeScript validation and the focused whitespace check also passed.

Run the isolated suite from the repository root:

```powershell
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/seed-persistence.ts
```

Legacy demo chart/widget files still exist in the frontend source, but the active
dashboard does not render those components. Theme and dashboard-layout preferences
use local browser storage; they are distinct from persisted business records.

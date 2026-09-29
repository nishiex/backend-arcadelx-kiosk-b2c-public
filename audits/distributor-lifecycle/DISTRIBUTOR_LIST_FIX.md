# Distributor list error: fixed

Verified 2026-09-29 against the running API and frontend.

## Cause

`GET /api/network/distributors` returned HTTP 500 directly on port 4000 and through
the frontend proxy on port 3000. The configured database has none of the new
Organization profile columns. The previous projection selected `gstNumber`,
`phone` and `country` unconditionally, producing Prisma P2022 / PostgreSQL 42703:
`column Organization.gstNumber does not exist`.

## Change

The Distributor list checks which profile columns exist and selects only those.
Missing profile fields return null; fields already present retain their saved
values. Organization details, owner details, counts and Company-only access
checks remain in place. The frontend response shape is unchanged.

Only the listing controller needed an application-code change. No configured
database rows or schema were changed. The pending lifecycle migration is still
required for organization creation and other writes; this fix restores listing
while that deployment remains pending.

## Verification

- Running API port 4000: **200**, two distributors returned.
- Frontend proxy port 3000: **200**, two distributors returned.
- Real browser `/distributors`: two table rows rendered; the error state was absent.
  Requests reached the real API with no mocked responses. Verification used only
  GET requests and a temporary in-memory access token; no login-session rows were created.
- Backend TypeScript no-emit check and `git diff --check` passed.
- Isolated regression: **9 HTTP requests, 7 assertions, zero mismatches**. Full,
  legacy, partially migrated and restored schemas all passed. Unauthorized and
  wrong-organization-type requests remained blocked.
- Fixture columns were temporarily renamed only inside a new local test database
  and restored afterward. Existing local database fingerprints were unchanged.

Evidence: [20260929091027876/evidence.json](20260929091027876/evidence.json).

Repeat the isolated check from the repository root:

```powershell
$env:AUDIT_PHASES='distributor_compat'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

`distributor-list-diagnostic.ts` performs read-only configured-database and HTTP
checks. Setting `DIAG_BROWSER=1` also checks the real frontend using the local
temporary Playwright installation from this session. It logs statuses and counts,
not tokens or personal records.

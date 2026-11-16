# Distributor agreement and list-loading audit — 2026-11-16

## Scope

This audit covers the two UI failures reported while using `/distributors`:

1. `Couldn't load this distributor's agreement details.`
2. `Couldn't load distributors.`

## Findings and repairs

### 1. Agreement details — repaired

`DistributorAgreementDialog` requests `GET /api/agreements/child/:childOrgId` with a
Distributor organization ID. The endpoint previously required the target organization
to be a `PARTNER`, so Company → Distributor agreement requests were rejected with 403.

The endpoint now permits:

- Company callers to read direct Distributor or Partner agreement history.
- Distributor callers to read Partner agreement history.

Authorization remains hierarchy-scoped: the target organization must have a parent
organization in the caller's permitted parent list. No broad agreement visibility was
added.

### 2. Distributor list — environment issue identified and diagnostics improved

The distributor list is loaded from `GET /api/network/distributors`. At audit time no
Node API process was running in the workspace, which explains the generic frontend
failure when the page cannot reach port 4000. The API was started successfully on port
4000 during the audit.

The page now displays the underlying request error instead of always replacing it with
`Couldn't load distributors.`, while retaining the Retry action.

The API process also emitted Redis connection warnings for `127.0.0.1:6379`. Redis is
used by optional background jobs and is not required by the distributor list endpoint.

## Changed files

- `apps/api/src/controllers/Agreement/agreement.controller.ts`
  - Generalized and retained hierarchy checks for `getAgreementsForChild`.
- `apps/web/next-monorepo/apps/web/components/distributors/DistributorsScreen.tsx`
  - Shows the actual query error in the distributor-list failure state.
- `apps/web/next-monorepo/apps/web/scripts/distributor-agreement-ui-check.tsx`
  - Mocks the exact `/api/agreements/child/:childOrgId` request used by the dialog.
- `apps/web/next-monorepo/apps/web/components/kiosks/KiosksScreen.tsx`
  - Unrelated earlier change: `/kiosks` defaults to All machines.
- `apps/web/next-monorepo/apps/web/scripts/kiosks-paired-only-ui-check.tsx`
  - Updated for the `/kiosks` default change.

## Verification

- API TypeScript check: passed (`npm run typecheck` in `apps/api`).
- Web TypeScript check: passed (`npm run typecheck` in `apps/web/next-monorepo/apps/web`).
- `git diff --check`: passed.
- API startup: server reached `Server Running on 4000`.
- Browser UI harnesses: not executed because the workspace does not have `jsdom` installed;
  the harnesses report `Cannot find module 'jsdom'` before rendering.

## User action

Refresh `/distributors` after ensuring the API is running. If the list still fails, the
page now exposes the specific API/network error so it can be distinguished from an
authorization, database, or unavailable-service problem.

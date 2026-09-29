# Company inventory after transfer

The user requested that transferred machines stop appearing in the Company
dashboard. The frontend now filters both **Kiosks** and **Recent kiosks** to the
signed-in organization's `currentOrgId`, using the shared `useOwnedKiosks` hook.

Filtering happens before model options, search, pagination and the recent-list
limit. The existing API cache and invalidation keys are preserved. The hook waits
for the organization identity and handles identity/inventory loading and errors.
Empty inventory wording applies both to a new organization and to transferred stock.

Ownership changes at **delivery**. Reserved or dispatched Company-owned machines
remain in its inventory until that transfer completes. Backend access rules,
Prisma, assignment history, order logic and financial behavior were not changed.
The Company can still see Distributor counts in its Distributors section.

## Verification, 2026-09-29

Fresh local HTTP/database/browser regression: **139 requests, 47 assertions, zero
mismatches**. [Evidence and screenshots](20260929093808077/TRANSFER.md).

- Before transfer: Company list and dashboard show its 130 kiosks.
- After partial transfers: only the remaining 110, then 10 Company kiosks appear.
- Model dropdown options are restricted to remaining owned machines.
- After all deliveries: Company Kiosks list and Recent kiosks are empty; dashboard
  total is zero. Distributor inventory and dashboard show 130.
- Every Distributor kiosk still displays **Test Distributor Pvt Ltf**.
- Company Distributor-list count remains 130; closed assignment history remains.
- Frontend typecheck passed. Lint: zero errors, 63 pre-existing warnings.
- All 18 additional pagination/filter/loading/empty/retry/mobile browser checks passed.

The transfer used synthetic accounts/inventory in an isolated, fully migrated
database. The running database remains unchanged and still owns its original
130 kiosks under the Company. The UI change does not itself transfer those rows.

Repeat the isolated regression from the repository root:

```powershell
$env:AUDIT_PHASES='transfer_130'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

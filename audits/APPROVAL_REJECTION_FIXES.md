# Approval/rejection implementation — 30 September 2026

The member decision race and join-query defect are fixed. Network, agreement and order rejection APIs, review controls, member pagination, role filtering and polling are implemented and tested. **The legacy order repair is committed, and the independent request-rejection enum migration is deployed.** Network/agreement rejection is now enabled. Order processing remains blocked by its unapplied lifecycle migration and two missing historical migration sources. See the [reconciliation plan](SCHEMA_RECONCILIATION_PLAN.md).

## Final behavior

| Flow | Authorized actor and eligible state | Result |
| --- | --- | --- |
| Member approval/rejection | Company Owner/Admin; scoped PENDING membership; approver may grant only a lower role | Atomic conditional update; one winner under concurrency, other request gets 400 already processed/not found. Rejection clears role and retains user/membership. |
| Network rejection | Receiving organization Owner/Admin; PENDING connection | POST `/api/network/:connectionId/reject` changes it to REJECTED; record retained. Rejected connections cannot be deleted or reaccepted. Existing canonical pair uniqueness still prevents reinitiating the same relationship. |
| Agreement rejection | Receiving organization Owner; PENDING_APPROVAL agreement | PATCH `/api/agreements/:agreementId/reject` changes it to REJECTED and records effectiveTo; terms and row retained. Uses the same organization lock as approval. A later new proposal can occupy the freed agreement slot. |
| Order rejection | Supplier Company/Distributor Owner/Admin; REQUEST, UNDER_REVIEW, payment PENDING, no kiosk/history links or reservations | PATCH `/api/orders/:orderId/reject` changes it to REJECTED. No inventory, payment, financial snapshot or historical link is modified. Approved/allocated, paid, dispatched and delivered orders cannot be rejected. |

`/api/auth/join` selects only Organization ID, type and invite expiry. It works when optional profile columns are absent. Member list pagination has a deterministic ID tie-breaker and a consistent count/row snapshot.

The additive `20260930070000_request_rejections` migration adds REJECTED enum values to NetworkStatus and AgreementStatus. It is now independently applied and registered in Supabase after a local upgrade rehearsal. See [deployment evidence](REQUEST_REJECTION_DEPLOYMENT.md).

## Frontend

- `/user`: 50-row pages, Next/Previous, total count, automatic return to a valid page after processing the last row, role choices limited to the approver's authority, 10-second polling and invalidation of pending-list/dashboard counts on decisions.
- `/requests`: incoming/outgoing network and agreement history with 20-row pages and 10-second polling. Recipient-only actions, Owner-only agreement decisions, visible financial terms and confirmation dialogs.
- `/orders`: supplier-only Approve/Reject controls on unpaid requests under review. Dialogs explain reservation or history consequences. Mutations refresh orders and inventory queries.
- Sidebar and notification links expose Requests to eligible Company, Distributor and Partner Owners/Admins. Network and member notification counts poll every 10 seconds.
- Authenticated `/api/workflows` reports deployment readiness. Rejection controls require their enum migration; order controls require the reservation column and order/delivery tables. Unsupported writes return 503 instead of an internal error. Readiness is not proof of full schema/data integrity.

## Verification

| Suite | HTTP requests | Assertions | Evidence |
| --- | ---: | ---: | --- |
| Members, including 55-row pagination | 62 | 36 | [20260930065952009](distributor-lifecycle/20260930065952009/evidence.json) |
| Updated approval_edges | 75 | 31 | [20260930065645005](distributor-lifecycle/20260930065645005/evidence.json) |
| Rejection permission/concurrency/inventory tests | 73 | 22 | [20260930065746956](distributor-lifecycle/20260930065746956/evidence.json) |
| Existing lifecycle, fixes, invites and compatibility regression | 341 | 98 | [20260930070207059](distributor-lifecycle/20260930070207059/evidence.json) |
| Component interactions with simulated DOM/API | — | 15 | [UI evidence](approval-rejection-ui.json) |

All listed checks passed: **551 HTTP requests, 187 API/database assertions and 15 component checks**. The schema-gap test verifies that join succeeds and order actions return a controlled 503 until reconciliation; it does not claim the order schema has been repaired.

The component tests render the real React components using jsdom and mocked HTTP responses. They exercise role options, pagination, last-page removal, polling, confirmations, HTTP method/path selection, history updates and disabled/unavailable order controls. They do not replace visual tests in a connected browser; no browser surface was available.

API and frontend TypeScript checks, Prisma validation, targeted ESLint and the production Next.js build passed. All mutation tests ran in fresh local databases with captured email. Existing local database fingerprints remained unchanged.

Final running-app smoke checks passed through the frontend proxy: authenticated network/agreement history reads, API health, and HTTP 200 for `/user`, `/orders`, and `/requests`. `/api/workflows` correctly returned false for all three migration-dependent capabilities. The smoke session was logged out afterward; no business records were changed. Component tests wait for the query notification to render role changes before asserting the dropdown options.

## Run again

From the repository root, run the harness separately for `members`, `approval_edges`, `rejections`, and `happy,fixes,distributor_invites,invite_generation_compat`:

```powershell
$env:AUDIT_PHASES = 'approval_edges'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

For component checks, install jsdom into `%TEMP%/arcadelx-ui-tests` (outside the app's dependencies), then:

```powershell
npx.cmd tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/decision-ui-check.tsx
```

The running app now includes the code/UI fixes. Network/agreement rejection is enabled in Supabase. Order processing remains disabled while its lifecycle migration is missing. The order repair is complete; the outstanding migration sources and exact checksums are in the reconciliation plan.

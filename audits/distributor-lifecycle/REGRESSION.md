# Fresh Distributor regression results

**The repository is mounted and the current implementation was executed. Overall result: FAIL.**

Workspace: `C:\Users\Abcom\Desktop\backend-arcadelx-kiosk-b2c`. Run: **20260929072537010**. [New evidence](20260929072537010/evidence.json), [HTTP matrix](20260929072537010/HTTP_RESULTS.md), [execution log](regression-run.log), [original detailed findings and fixes](REPORT.md).

## Baseline and verification

- **Serial baseline: PASS** — Company creates Distributor -> ACTIVE OWNER -> active network/agreement -> Distributor receives Company stock -> creates Partner -> active downstream network/agreement -> same Company-origin kiosk reaches Partner with ownership and assignment history checked.
- Executed **391 HTTP requests**, **58 assertions**, and **10 rollback-only database constraint probes**.
- Current backend source/schema/shared-validation hashes match the original audited files: **yes**. A fresh run was still performed; previous results were not substituted for execution.
- New isolated PostgreSQL database: `arcadelx_audit_20260929072537010`, with the nine repository migrations applied there. Application sources unchanged during run: **true**. Existing local database data unchanged: **true**.
- Mailjet transport captured 28 messages locally. Real external email delivery remains **NOT VERIFIED**. Remote Supabase access was schema metadata only in a read-only transaction; no regression mutations were sent to it.
- Lower-role Distributor/Partner users and selected history/concurrency stock were explicit fixtures. Main Distributor/Partner owner creation, authentication, and stock transfer used real HTTP handlers and database writes.

## F1–F13

| ID | Target | Fresh result | Observation | Evidence IDs |
| --- | --- | --- | --- | --- |
| F1 | Role bypasses | FAIL — reproduced | Company STAFF registration returns 201; Distributor STAFF kiosk mutation returns 200. | authorization-company-owner-STAFF-register; authorization-distributor-owner-STAFF-kiosk-status |
| F2 | Agreement/network relationship bypass | FAIL — reproduced | A mismatched network/child agreement is created and approved, then authorizes an order. Invalid/self organization types also succeed. | agreement-unrelated-child-endpoints; mismatched-agreement-authorizes-order-create |
| F3 | Duplicate active agreements | FAIL — reproduced | Two pending agreements can both become ACTIVE. | duplicate-pending-approve-1; at-most-one-active-partner-agreement |
| F4 | Manual kiosk state bypass | FAIL — reproduced | Manual release of RESERVED stock permits a second active allocation of the same kiosk. | reserved-kiosk-manually-released; one-kiosk-one-active-order |
| F5 | Stale ownership transfer | FAIL — reproduced | A stale company order overwrites a kiosk already transferred to another Distributor. | shared-order-deliver-second-overwrites-owner; delivery-preserves-owner-on-stale-order |
| F6 | Email-failure recovery | FAIL — reproduced | Injected mail failure returns 500 after account/order commits; registration retry is 409 and approval retry 400. | registration-email-failure; failed-registration-left-active-account; approval-committed-despite-email-failure |
| F7 | Invoice URL | FAIL — reproduced | Persisted /orders/:id/invoice returns 404; /api/orders/:id/invoice returns the PDF. | stored-invoice-url-direct; invoice-real-route-child |
| F8 | Fractional money truncation | FAIL — reproduced | Input 1000.75 is accepted with HTTP 201 and stored as 1000. | fractional-agreement-amount |
| F9 | Network deletion with history | FAIL — reproduced | Pending-only and terminated-only agreement references produce foreign-key errors surfaced as HTTP 500. | delete-link-with-only-terminated-agreement; delete-link-with-only-pending-agreement |
| F10 | Validation/error responses | FAIL — reproduced | Invalid quantities and unknown invite codes return 500. Invalid quantities are blocked from order creation. | invalid-order-quantity-1.5; invalid-invite-code |
| F11 | Distributor profile fields | FAIL — reproduced | Submitted GST number, phone and country return as null rather than persisted values. | submitted-distributor-fields-retained |
| F12 | Termination semantics | PARTIAL — policy decision remains | New upstream requests fail after termination; an existing request can still be approved and an active downstream agreement still supports new allocation and fulfillment. Decide whether these obligations are grandfathered before labeling all such behavior invalid. | old-request-approved-after-termination; downstream-allocation-after-upstream-termination |
| F13 | Actual UI lifecycle | FAIL — incomplete implementation; browser lifecycle NOT VERIFIED | Current orders source uses PlaceholderPage; targeted current frontend search found 0 agreement/order/network-initiate-or-accept API caller matches. GET /orders returned 200. No interactive browser lifecycle was executed. | regression-ui-check.json |

F6 is a controlled injected transport failure, not an outage induced at the live email provider. F12 policy outcomes are kept separate from unconditional corruption findings. F13 is source inspection plus a read-only page request, not a claimed browser end-to-end pass.

## R1–R9

| ID | Case | HTTP results | Fresh observation |
| --- | --- | --- | --- |
| R1 | Two reservations | 200 + 200 | Same kiosk in two APPROVED orders. Invariant check: FAIL. |
| R2 | Two approvals of one order | 200 + 500 | One succeeds; one returns 500. Composite key prevents a duplicate pair in that order. |
| R3 | Concurrent order numbers | 500 + 201 | One valid request fails on duplicate orderNumber. Invariant check: FAIL. |
| R4 | Concurrent delivery | 200 + 200 | Two successful deliveries leave two open child assignment records. Invariant check: FAIL. |
| R5 | Duplicate network creation | 201 + 201 | Two network rows for the same organization pair. Invariant check: FAIL. |
| R6 | Duplicate agreement creation | 201 + 201 | Two drafts are accepted and can both become ACTIVE. Invariant check: FAIL. |
| R7 | Concurrent connection acceptance | 200 + 200 | Both return success; final connection is ACTIVE. No corruption observed from this case alone. |
| R8 | Concurrent approval of one agreement | 200 + 200 | Both return success on one agreement. No duplicate agreement caused by this case alone. |
| R9 | Status change during delivery | Retirement 200; delivery 200 | Final state is AVAILABLE; delivery overwrites the concurrent retirement. |

All eight paired concurrency tests observed both requests waiting on database locks before release. R9 used a delivery paused on its assignment row while the actual kiosk status endpoint was called. R7/R8 demonstrate repeat success, but did not independently corrupt data.

## Comparison with previous evidence

- Newly observed mismatch IDs: none.
- Previous mismatch IDs no longer observed: none.
- No application fixes were made. The original detailed report remains available; this file records the fresh run and its exact coverage.

Re-run from repository root:

```powershell
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

The harness completes successfully even when it records expected defect reproductions; its exit code means execution completed, not that all regression requirements passed. Audit databases and PDFs are retained.

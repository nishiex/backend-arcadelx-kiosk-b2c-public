# Requests / Agreements check — 30 September 2026

**Later deployment update:** the independent rejection-enum migration is now
applied in Supabase, and both rejection readiness flags are true. The deployment
preserved the existing ACTIVE agreement. [Current deployment status](REQUEST_REJECTION_DEPLOYMENT.md).
The unavailable-rejection observations below describe the earlier test run.

The agreement lifecycle tests passed. The running agreement list also returned
HTTP 200 with one saved ACTIVE agreement. No live agreement was created,
approved, rejected or terminated by this check; no application code changed.

## Verified behavior

| Case | Result |
| --- | --- |
| Draft agreement over an active network | Creates PENDING_APPROVAL in the database |
| Receiving Owner approves | Becomes ACTIVE |
| Receiving Owner rejects a pending draft | Becomes REJECTED; row and financial terms retained |
| Admin, Manager, Staff or inactive membership decides | Refused |
| Sending Owner or unrelated organization decides | Refused |
| Concurrent Approve and Reject | Exactly one succeeds; other receives 404 already processed/not pending |
| Approve a rejected or terminated agreement | Refused |
| Terminate a pending agreement | Refused; termination applies only to ACTIVE agreements |
| New draft following rejection/termination | Allowed after the previous agreement leaves the open slot |
| History visibility | Both parties see their agreements; unrelated organizations do not |
| Requests component permissions | Admin cannot decide agreements; Owner can open the rejection confirmation |
| Requests component rejection | Sends PATCH to the correct endpoint and refreshes the list |

## Evidence

- [approval_edges](distributor-lifecycle/20260930075434630/evidence.json):
  75 HTTP requests, 31 assertions, zero mismatches.
- [rejections](distributor-lifecycle/20260930075518968/evidence.json):
  73 HTTP requests, 22 assertions, zero mismatches.
- [Component suite](approval-rejection-ui.json): all 15 checks passed. This uses
  actual React components in jsdom with mocked HTTP; it is not a visual browser test.

These API suites also cover other decision flows; their totals are not counts of
agreement-only tests. Mutations ran in newly created local databases with captured
email. Both runs confirmed unchanged application sources and existing local data.

## Running database and remaining deployment limitation

Authenticated `/api/agreements?page=1&limit=20` returned one ACTIVE agreement.
An ACTIVE agreement correctly has no pending Approve/Reject controls. Pending
decisions appear only to the receiving organization's Owner.

`/api/workflows` returned `agreementRejection: false`. Supabase still lacks the
REJECTED enum migration, so agreement rejection remains unavailable there.
The isolated schema-compatibility test confirms the guarded rejection endpoint
returns 503 before writing. Approval was exercised against a local simulation
of the configured older schema and passed. The missing historical migration
sources remain documented in [the reconciliation plan](SCHEMA_RECONCILIATION_PLAN.md).

The first live smoke attempt returned 500; the development proxy log contained
connection-refused errors for API port 4000. The subsequent check returned 200
for login, identity, agreement listing, workflow readiness and logout. No
persistent agreement-list failure was reproduced, and no code workaround was made.

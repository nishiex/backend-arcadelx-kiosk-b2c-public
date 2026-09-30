# Approval and rejection review — 30 September 2026

**Historical audit:** implementation now addresses the race, join query and missing rejection/UI flows. See [current fixes and verification](APPROVAL_REJECTION_FIXES.md). Supabase reconciliation remains pending as described in [the deployment plan](SCHEMA_RECONCILIATION_PLAN.md). The findings below describe the pre-fix state.

**Result: not all flows are complete or working correctly.** Normal sequential member decisions and the implemented network/agreement/order approval APIs pass against a fully migrated local database. Additional tests reproduce a member-decision race and two failures when the configured database's missing schema elements are simulated. Network, agreement and order rejection flows are not implemented.

This is a review, not a deployment or application-code fix. Tests use new local databases; the configured Supabase database was queried only for schema metadata in a read-only transaction. Existing local data and application source hashes were unchanged. Outgoing email was captured in memory.

## Findings

### 1. High: simultaneous member decisions can overwrite each other

In [membership.controller.ts](../apps/api/src/controllers/membership.controller.ts), `handleJoinRequest` first reads a PENDING membership at line 73, then updates by ID alone at lines 85 and 102. The write does not require the row still to be PENDING, and the read/write pair is not locked in a transaction.

Two HTTP requests were deliberately held at their database writes, then released together. All three cases returned **200 to both callers**:

| Concurrent actions | Observed stored result | Expected |
| --- | --- | --- |
| Approve as Staff / Approve as Manager | ACTIVE, Manager | One decision succeeds; the other reports already processed |
| Reject / Reject | REJECTED, no role | One successful transition |
| Approve as Staff / Reject | REJECTED, Staff role retained | Conflicting decisions cannot both succeed |

The final result depends on write order. Repeated requests made sequentially are correctly blocked, which is why the earlier member tests passed.

Evidence: `decision-race-*-overlap-confirmed` and `decision-race-*-one-winner` in the [extended run](distributor-lifecycle/20260930064357357/evidence.json). Fix direction: make the scoped PENDING-to-final transition atomic and check the affected-row count, or lock and recheck within one transaction.

### 2. High: new join requests fail with the configured database's profile-column gaps

Read-only inspection confirmed that `Organization.gstNumber`, `phone` and `country` are absent. [auth.controller.ts](../apps/api/src/controllers/auth.controller.ts), line 203, reads the whole Organization during `/api/auth/join`, so Prisma expects those columns even though joining only needs the ID, type and invite expiry.

With those observed columns unavailable in the isolated database, a valid invite and new applicant returned **500** instead of 201. Existing pending requests could still be listed, approved and rejected. This blocks the entry into the member approval flow, rather than the ordinary decision on an existing request.

Evidence: `decision-configured-schema-join`, `decision-configured-schema-new-user-can-request-membership`, and the successful `decision-configured-schema-existing-*` checks. Fix direction: select only the fields required for joining, with a regression check against the older schema.

### 3. High: order approval requires schema elements absent from the configured database

Observed gaps include `Kiosk.reservedOrderId`, `EmailDelivery` and `OrderSequence`. [orders.controller.ts](../apps/api/src/controllers/Orders/orders.controller.ts), line 29, requires the reservation column; approval at line 209 also queues invoice delivery.

A valid pending order with available stock returned **500** when these observed gaps were reproduced locally. The failed transaction retained the original UNDER_REVIEW order. Approval passed with the repository schema fully applied, including after an insufficient-stock failure and retry.

Evidence: `decision-configured-schema-order-approve`, `decision-configured-schema-order-can-be-approved`, and `decision-configured-schema-failed-order-approval-retains-pending-order`. This simulation reproduces missing columns/tables, not every difference or business record in the configured database.

The existing migration-history and inconsistent-order blockers documented in [apps/api/AGENTS.md](../apps/api/AGENTS.md) still need reconciliation before deploying the lifecycle migration. No migration was attempted against Supabase.

### 4. Functional gaps: rejection and browser controls are missing outside member requests

| Flow | Implemented server decision | Rejection support | Frontend status from source review |
| --- | --- | --- | --- |
| Members | Company Owner/Admin can approve; only lower roles may be assigned | Implemented | `/user` has Approve/Reject; serial API behavior passes, concurrent decisions fail |
| Network connections | Recipient Owner/Admin can accept | No reject handler or REJECTED state | No accept/reject controls found in the current frontend |
| Agreements | Recipient Owner can approve | No reject handler/state; pending agreements cannot be terminated | No agreement approval/rejection controls found |
| Orders | Supplier Owner/Admin can approve a pending request | No reject handler, despite the REJECTED enum/filter | Orders page provides viewing/filtering, with no approval/rejection controls |

The missing rejection endpoints returned 404 in the isolated tests and left the requests unchanged. Network deletion is restricted to the initiating organization's Owner, so recipients cannot use it to reject an incoming request. Agreement termination operates only on ACTIVE agreements; it is not rejection of a pending proposal.

These are missing features, not failing implementations of existing rejection handlers. Adding them requires explicit decisions about valid states, authorized actors, history retention and any inventory release.

### 5. Smaller member-page issues found in source review

- The role dropdown offers Admin even to an Admin approver; the backend correctly rejects that selection with 403. It should offer only assignable roles.
- `/user` fetches the first 50 pending requests without pagination controls. Later requests can be reached only after enough earlier requests are processed.
- The pending-list query has no polling interval. Same-screen decisions invalidate it and the dashboard count, but it does not continuously refresh when another reviewer acts.

These observations are from source inspection, not browser interaction tests.

## Verification and evidence

| Suite | HTTP requests | Assertions | Result |
| --- | ---: | ---: | --- |
| [Members, earlier in this session](distributor-lifecycle/20260930063159017/evidence.json) | 53 | 32 | All passed |
| [Fresh lifecycle and existing regression suite](distributor-lifecycle/20260930064103463/evidence.json) | 294 | 71 | All passed |
| [Final extended decision audit](distributor-lifecycle/20260930064357357/evidence.json) | 66 | 29 | 7 failed expectations covering the 3 defects above |

The extended suite's 7 failures are three race assertions, plus an HTTP expectation and a state assertion for each of the join and order schema failures. Checks that a missing endpoint returns 404 establish its absence; they do not mean a rejection feature passed.

The existing regression suite includes wrong-organization and lower-role denial, pending/rejected-account denial, repeated approval prevention, simultaneous network acceptance/agreement approval/order approval, stock reservation isolation, order progression, and invoice/PDF retry behavior. Extended tests add the full allowed member role matrix, member decision races, recipient Admin network acceptance, pending/terminated agreement behavior, insufficient-stock rollback and retry, and observed schema-gap simulations.

Browser inventory returned no available apps or browsers. Button clicks, visual feedback and browser cache updates remain unverified. No claim of complete browser end-to-end success is made.

Run each suite from the repository root; each command creates its own new local audit database:

```powershell
$env:AUDIT_PHASES = 'members'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts

$env:AUDIT_PHASES = 'happy,fixes'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts

$env:AUDIT_PHASES = 'approval_edges'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

The extended audit intentionally exits nonzero until the documented defects are resolved. Its source is [approval_edges.ts](distributor-lifecycle/harness/phases/approval_edges.ts).

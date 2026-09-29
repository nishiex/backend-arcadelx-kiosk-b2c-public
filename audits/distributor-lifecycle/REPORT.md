# Distributor lifecycle audit

**Result: FAIL against the complete requested lifecycle requirements.** The ordinary serial Company -> Distributor -> Partner scenario works with a functioning email transport. Authorization gaps, incorrect relationship validation, unsafe state changes, and reproduced races prevent treating the lifecycle as correct under the requested negative and concurrent cases.

Audited 2026-09-29. Primary evidence: [evidence.json](20260929071045080/evidence.json). Reproducible harness: [distributor-lifecycle.ts](harness/distributor-lifecycle.ts), with separate [happy](harness/phases/happy.ts), [negative](harness/phases/negative.ts), [concurrency](harness/phases/concurrency.ts), and [integrity](harness/phases/integrity.ts) phases.

## Verification boundary

- Completed **391 real HTTP requests**, **58 recorded assertions**, and **10 additional database constraint probes** in the primary run. Eight paired concurrency scenarios reached a verified database-lock barrier before release; an additional delivery/status interleaving was tested.
- Ran the unchanged Express application, middleware, controllers, shared Zod schemas, generated Prisma client, and real PostgreSQL. The server listened only on an ephemeral loopback port.
- Applied all **nine existing repository SQL migrations** to a newly created local database: `arcadelx_audit_20260929071045080`. No migration was rewritten. No existing database was reset, reseeded, or cleared.
- Captured **28 email messages in memory** by replacing only the Mailjet transport in the harness. No email was sent externally. Actual Mailjet delivery and user receipt are **NOT VERIFIED**. Separate tests injected an email transport failure.
- The company owner and additional role actors were explicit synthetic fixtures. Distributor and Partner owners in the main scenario were created through HTTP and logged in using the actual generated password captured from the email. No access JWT was fabricated. Additional Distributor/Partner ADMIN/MANAGER/STAFF memberships were direct fixtures because public membership management is company-only.
- Initial company assignment history and two concurrency/state test kiosks were explicit fixtures, identified in the evidence. Ordinary Company -> Distributor -> Partner stock was minted and transferred through HTTP.
- The existing Docker database's row counts and content digests matched before/after. Application source, Prisma files, and shared validation file hashes matched before/after. Constraint probes used transactions rolled back after observation.
- Earlier setup/diagnostic runs are retained in adjacent timestamped directories. Use the primary run above for the consolidated results; earlier runs exposed fixture setup issues and the stale local database, rather than additional application defects.

### Actual environment, rather than the setup guide

The running API's root environment points to **Supabase** (`aws-0-ap-southeast-2.pooler.supabase.com`), not Docker. `GET http://localhost:4000/health/db` succeeded, but that did not establish local Docker schema readiness.

The untouched Docker `arcadelx` database has six migrations and no `Order` table. The repository has nine migrations. Read-only schema inspection of the configured Supabase database found eleven migrations, including these two absent from this checkout:

- `20260928063729_implement_transactions_schema`
- `20260928073023_remove_payu_retries`

All constraints and indexes produced by the nine repository migrations were also present with matching definitions in the configured database. Additional remote schema exists; complete parity is not claimed. Runtime mutation findings were reproduced against the nine-migration local audit database, **not against Supabase customer data**. Supabase inspection ran in a read-only transaction and read schema/migration metadata only. Its live payment integration and the two extra migrations' application behavior are outside verified coverage.

## A. Lifecycle result

`PASS` means the stated check was observed to work; `FAIL` means at least one requested requirement was contradicted by evidence; `PARTIAL` means verification is incomplete; `NOT VERIFIED` means it was not executed. A stage's normal path can pass while its complete requirement set fails.

| Requested stage | Result | Verified normal behavior and reason for failure |
| --- | --- | --- |
| 1. Company creates Distributor | FAIL | HTTP 201 creates user, DISTRIBUTOR org, and ACTIVE OWNER membership; generated credentials log in. Company MANAGER/STAFF also create organizations. Email failure returns 500 after committing the account. |
| 2. Company/Distributor network | FAIL | PENDING -> ACTIVE works; wrong receiver, low roles, and sequential duplicates are rejected. Concurrent duplicate initiation creates two connections for the same pair. |
| 3. Company/Distributor agreement | FAIL | Pending -> child-owner approval -> ACTIVE works. Network endpoints, organization hierarchy, and self-agreements are not enforced. |
| 4. Commercial terms | FAIL for the literal requested Company/Distributor rule | Explicit 60/40 is stored when submitted, but Company may submit 75/25 successfully. Fixed 60/40 and inherited amounts are implemented for Distributor -> Partner, which passed. Fractional monetary input is silently truncated. |
| 5. Company allocates/orders kiosks to Distributor | FAIL | REQUEST and ALLOCATION paths, ordinary approval/payment/dispatch/delivery and totals work. Invoice URLs, concurrent reservations, order numbering, failure recovery, and post-termination checks have defects/gaps. |
| 6. Ownership transfer | FAIL | Serial delivery sets Distributor ownership, AVAILABLE, null location, and correct history. Stale orders can overwrite another Distributor's ownership; concurrent delivery creates duplicate open assignments. |
| 7. Distributor creates/connects/agrees with Partner | FAIL | Correct downstream flow and inherited terms work. Invalid child types, missing role gates on creation, and multiple pending agreements bypass restrictions. |
| 8. Distributor transfers Company-origin stock to Partner | FAIL | The complete serial chain passed, including ledger closure and scoped inventory. The same reservation/state/history failures affect downstream fulfillment. |

Additional coverage: real email delivery **NOT VERIFIED**; full browser/UI lifecycle **FAIL by source inspection** (orders are a placeholder and necessary mutation callers are absent); destructive live-data tests **NOT VERIFIED by design**.

## B. Actual flow and state machines

The executed normal path was:

```text
Company owner fixture -> actual login cookie
  -> POST /api/auth/register (DISTRIBUTOR)
  -> Distributor user + organization + ACTIVE OWNER membership
  -> actual Distributor login using captured temporary password
  -> Company POST /api/network/initiate -> PENDING
  -> Distributor POST /api/network/:id/accept -> ACTIVE
  -> Company POST /api/agreements/create -> PENDING_APPROVAL
  -> Distributor OWNER PATCH /api/agreements/:id/approve -> ACTIVE
  -> Company POST /api/kiosks/batch -> AVAILABLE stock
  -> Distributor POST /api/orders/create (REQUEST, quantity 2) -> UNDER_REVIEW
  -> Company ADMIN approve -> APPROVED; kiosks RESERVED; PDF generated
  -> Company ADMIN paid -> PAID
  -> Company ADMIN dispatch -> DISPATCHED; kiosks ASSIGNED, still Company-owned
  -> Company ADMIN deliver -> DELIVERED; Distributor-owned AVAILABLE stock
  -> Distributor POST /api/auth/register (PARTNER)
  -> Distributor initiate / Partner accept network -> ACTIVE
  -> Distributor draft / Partner OWNER approve agreement -> ACTIVE
  -> Distributor POST /api/orders/create (ALLOCATION, quantity 1)
  -> immediately APPROVED; Distributor stock RESERVED; PDF generated
  -> Distributor paid / dispatch / deliver
  -> Partner-owned AVAILABLE kiosk; Distributor ledger row closed
```

### Implemented transitions

| Entity | Actual transitions | Missing, bypassable, or repeated transitions |
| --- | --- | --- |
| Membership | Registration creates ACTIVE OWNER. Company invite join creates PENDING with null role. PENDING -> ACTIVE with assigned role or REJECTED. ACTIVE role changes and membership deletion are supported for lower-ranked company members. | REJECTED has no retry/reopen path. Removing membership retains User; joining again with that email returns 409. No public Distributor/Partner member-management flow. Pending/rejected users can authenticate but active-membership middleware denies business operations. |
| NetworkConnection | Absent -> PENDING -> ACTIVE. Initiator OWNER may physically delete an unused pending/active link. | No receiver decline route/state. Sequential accept repeats return 404; concurrent repeats both return 200 with a single ACTIVE row. Pair uniqueness is not enforced in DB. Historical agreements prevent deletion. |
| Agreement | API creates PENDING_APPROVAL; child OWNER -> ACTIVE; parent OWNER -> TERMINATED with effectiveTo. | DRAFT is a DB default/enum value with no API path creating it. No pending rejection/cancellation route. Duplicate pending agreements can both become ACTIVE. Same agreement's concurrent approvals both succeed. Active checks use status, not date validity. |
| Order | REQUEST -> UNDER_REVIEW -> APPROVED. ALLOCATION starts APPROVED. APPROVED + PAID -> DISPATCHED -> DELIVERED. | REJECTED exists only in the enum; no rejection/cancellation/return handler. Sequential repeats are rejected. Checks before transactions are not concurrency-safe. No lifecycle reservation release/recovery flow after invoice/email failure. |
| Payment | PENDING -> PAID by supplier OWNER/ADMIN on an APPROVED order. | FAILED and REFUNDED are not set by these routes. This is a manual flag, not proof of gateway payment verification. Repeated serial PAID is rejected. |
| Kiosk | Mint -> AVAILABLE. Reserve -> RESERVED. Dispatch -> ASSIGNED. Delivery -> AVAILABLE under the child. | Direct status endpoint permits every enum -> every enum for company/distributor members. INSTALLED requires new/existing location; AVAILABLE/RETURNED clear location. RETIRED can become AVAILABLE through delivery; RESERVED/ASSIGNED can be manually reset. Partner cannot change status. |
| KioskAssignment | Delivery closes every currently open matching row, then creates a child row with orderId and assignedById. | Minting creates no initial company ledger row. No DB uniqueness for one open assignment. Concurrent deliveries can create two open rows; stale delivery can close the wrong current owner's history. |

Source: `apps/api/src/controllers/membership.controller.ts:58,108,161`; `Network/network.controller.ts:11,143,165`; `Agreement/agreement.controller.ts:10,100,125`; `Orders/orders.controller.ts:54,228,420,447,502`; `Kiosk/kiosk.controller.ts:24,112`.

### Commercial terms interpretation

The request's step 4 mixes two levels. A Company -> Distributor agreement is the source agreement; it cannot inherit its initial deposit from itself. Its controller accepts explicit shares totaling 100 and explicit amounts. The downstream Distributor -> Partner agreement fixes shares at 60/40 and copies amounts from an active Company -> Distributor agreement.

Verified values:

- Upstream submitted/stored: 60/40; deposit 1000; non-refundable 200.
- Downstream submitted: 5/95; deposit 99999; non-refundable 88888. Stored: **60/40; 1000; 200**.
- Two-kiosk upstream order: deposit 2000 + non-refundable 400 + GST 72 = **2472**.
- One-kiosk downstream order: deposit 1000 + non-refundable 200 + GST 36 = **1236**.
- A separate Company -> Distributor draft accepted **75/25**.

If the intended Company -> Distributor rule is also mandatory 60/40, that requires a focused rule change. The existing downstream inheritance behavior is working. This requirement mismatch is separate from the verified integrity bugs below.

## C. Expected vs actual, with reproduction evidence

Paths below are relative to the repository root. Evidence identifiers locate exact requests, actors, bodies, response statuses, and snapshots in `evidence.json`. Reproduction uses synthetic actors from the harness.

### F1. Organization creation and kiosk mutations omit role checks

- **Expected:** OWNER/ADMIN manage creation and inventory mutations; MANAGER/STAFF attempts are rejected under the requested authorization policy. The Distributor creation UI explicitly restricts creation to company OWNER/ADMIN.
- **Actual:** Company MANAGER and STAFF get 201 from registration and kiosk batch creation, and 200 from kiosk status mutation. Distributor MANAGER/STAFF create Partner organizations and mutate owned kiosks.
- **Source/route:** `apps/api/src/routes/auth.routes.ts:6`, `src/middlewares/auth.ts:97`, `src/controllers/auth.controller.ts:23`; `src/routes/Kiosk/kiosk.routes.ts`, `src/controllers/Kiosk/kiosk.controller.ts:24,112`. Frontend policy: `apps/web/next-monorepo/apps/web/hooks/useMe.ts`, `components/distributors/AddDistributorForm.tsx`.
- **Why it matters:** UI restrictions are bypassable using the actual API. Low roles can create accounts and interfere with order stock.
- **Reproduce:** Log in as the synthetic company STAFF; POST valid Distributor registration or `/api/kiosks/batch`. Log in as Distributor STAFF; POST Partner registration or PATCH an owned kiosk's status. Evidence: `authorization-company-owner-STAFF-register`, `authorization-company-owner-STAFF-kiosk-batch`, `authorization-distributor-owner-STAFF-register`, and corresponding MANAGER cases.

### F2. Agreement endpoints and organization hierarchy are not bound to the network

- **Expected:** The ACTIVE connection must join the proposed parent and child, with permitted distinct org types.
- **Actual:** Company uses its Company/Distributor connection to create an agreement with a different Distributor; that unrelated child can approve it and request an order against it. Distributor -> Company, Distributor -> Distributor, Distributor -> itself, and Company -> itself agreements are accepted and approvable.
- **Source/route:** `apps/api/src/controllers/Agreement/agreement.controller.ts:10`, POST `/api/agreements/create`; `:100`, PATCH `/:id/approve`. `createOrder` at `Orders/orders.controller.ts:54` trusts the resulting ACTIVE parent/child agreement.
- **Why it matters:** The network acceptance and hierarchy requirements can be bypassed; invalid relationships become order-authorizing agreements.
- **Reproduce:** For Company C, Distributor D, unrelated Distributor U, submit C-D's `networkConnectionId` with `childOrgId=U`; log in as U to approve; U requests kiosks from C. Evidence: `agreement-unrelated-child-endpoints`, `unrelated-child-can-approve-mismatched-agreement`, `mismatched-agreement-authorizes-order-create`. Wrong-type examples: `distributor-invalid-child-type-*`, `company-self-agreement`.

### F3. Multiple pending agreements bypass the single-active-distributor rule

- **Expected:** A Partner cannot end up with conflicting active Distributor agreements.
- **Actual:** Two drafts for the same Partner are accepted before either is ACTIVE. The Partner approves both, producing two ACTIVE rows. Another create is rejected only after an active row exists.
- **Source/route:** `Agreement/agreement.controller.ts:10,100`; POST `/api/agreements/create`, PATCH `/:id/approve`; `prisma/schema.prisma:159` has no supporting uniqueness constraint.
- **Why it matters:** Commercial terms and upstream selection become ambiguous; concurrency creates the same issue.
- **Reproduce:** Draft twice, then approve both. Evidence: `duplicate-pending-agreement-0/1`, `duplicate-pending-approve-0/1`, `at-most-one-active-partner-agreement` (count 2). Concurrent version is in section E.

### F4. Manual kiosk status changes bypass order reservations and retirement

- **Expected:** Reservation/in-transit stock cannot be released, reassigned, or retired through an unrelated manual status change.
- **Actual:** Distributor STAFF changes a RESERVED kiosk to AVAILABLE. A second allocation reserves that same kiosk. An ASSIGNED kiosk can be set RETIRED, then delivery succeeds and overwrites it to AVAILABLE.
- **Source/route:** `Kiosk/kiosk.controller.ts:112`, PATCH `/api/kiosks/:id/status`; shared `validationSchemas/Kiosk/kiosk.validation.ts`; `Orders/orders.controller.ts:12,502`.
- **Why it matters:** Double booking is reproducible even without concurrency; lifecycle protections cannot rely on status alone.
- **Reproduce:** Allocate one kiosk to Partner, PATCH it AVAILABLE, allocate again; compare both OrderKiosk rows. Then dispatch one order, PATCH kiosk RETIRED, deliver. Evidence: `reserved-kiosk-manually-released`, `one-kiosk-one-active-order`, `in-transit-kiosk-retired`, `delivery-overwrites-retired-status`.

### F5. Delivery can overwrite another organization's ownership

- **Expected:** Delivery changes only kiosks still owned by that order's supplier and validly assigned to that order; a stale order must fail.
- **Actual:** After the reservation race attaches one kiosk to two orders, the status endpoint allows both to reach DISPATCHED. Delivering order one transfers it to Distributor one. Delivering order two subsequently transfers it to Distributor two, even though the company no longer owns it.
- **Source/route:** `Orders/orders.controller.ts:502`, PATCH `/api/orders/:id/deliver`. The kiosk update filters only by kiosk IDs; the order state was checked before entering the transaction.
- **Why it matters:** Actual ownership and history can be overwritten using ordinary HTTP requests. This is a verified integrity failure, not merely a missing check noted in review.
- **Reproduce:** Use `two-reservations` test, pay both, dispatch first, PATCH shared kiosk RESERVED, dispatch second, deliver each. Evidence: `shared-order-deliver-second-overwrites-owner`, `delivery-preserves-owner-on-stale-order` with before/after owners.

### F6. Email failure reports failure after successful persistent mutations

- **Expected:** Clients can distinguish committed business operations from notification failures and recover without duplicate/conflicting retries.
- **Actual:** Registration returns 500 after creating an ACTIVE owner account; retry returns 409. Approval returns 500 after APPROVED/reservation/invoice metadata commit; retry approval returns 400.
- **Source/route:** `auth.controller.ts:23` POST `/api/auth/register`; `Orders/orders.controller.ts:228` PATCH `/api/orders/:id/approve`; `services/email/email.service.ts`. Allocation has the same post-commit notification order by source inspection.
- **Why it matters:** A newly created owner may never receive their only generated password, and callers cannot safely retry operations reported as failed.
- **Reproduce:** Harness transport throws once during registration or approval, then restore transport and retry. Evidence: `registration-email-failure`, `failed-registration-left-active-account`, `retry-after-registration-email-failure`, `approval-email-failure`, `approval-committed-despite-email-failure`, `retry-after-approval-email-failure`. Actual live provider outage was not induced.

### F7. Persisted invoice URL does not address the protected invoice route

- **Expected:** The returned/stored invoice URL is usable.
- **Actual:** `/orders/:id/invoice` returns 404. `/api/orders/:id/invoice` returns a PDF to the parent/child; unrelated org is denied 403.
- **Source/route:** `Orders/orders.controller.ts:184,308,356`; route mounted at `/api/orders` in `src/app.ts`.
- **Why it matters:** A client following the stored URL cannot open the generated invoice. No current frontend order caller was found that repairs the path.
- **Reproduce:** After approval, GET the stored `invoiceUrl`, then GET the actual API-prefixed path. Evidence: `stored-invoice-url-direct`, `invoice-real-route-child`, `invoice-wrong-org-denied`.

### F8. Fractional commercial amounts are silently truncated

- **Expected:** Either reject fractions for Int columns or preserve monetary precision consistently.
- **Actual:** Deposit `1000.75` passes Zod, returns 201, and is stored/returned as **1000**.
- **Source/route:** `packages/shared-types/validationSchemas/agreement.validation.ts`; `Agreement/agreement.controller.ts:10`; Int amount columns at `prisma/schema.prisma:159`. POST `/api/agreements/create`.
- **Why it matters:** Contract values differ from supplied values, and order snapshots inherit the changed amount.
- **Reproduce:** Submit valid company agreement with `depositAmountPerMachine:1000.75`. Evidence: `fractional-agreement-amount`.

### F9. Deleting a connection with historical/pending agreements returns 500

- **Expected:** Preserve history and give a deliberate conflict response, or implement logical disconnection.
- **Actual:** Handler checks only ACTIVE agreements. With only a TERMINATED agreement, or only a PENDING_APPROVAL agreement, physical delete reaches a restricting FK and returns 500. The relationship/history remains in the DB.
- **Source/route:** `Network/network.controller.ts:165`, DELETE `/api/network/:id`; network FK in `prisma/migrations/20260914132819_implement_agreement_and_network_connection_schemas/migration.sql`.
- **Why it matters:** The API's allowed operation is incompatible with the schema. This is an error-handling/lifecycle mismatch, not observed data loss.
- **Reproduce:** Create and approve a network/agreement, terminate agreement, delete network; repeat with pending-only agreement. Evidence: `delete-link-with-only-terminated-agreement`, `delete-link-with-only-pending-agreement`. An unused link successfully deletes (`delete-unused-network`).

### F10. Validation errors use 500, and invalid invite code dereferences null

- **Expected:** Invalid quantity fails as a client error; invalid invite yields the explicit intended 404.
- **Actual:** Quantities 0, -1, 1.5, 51 all return 500, with no order created. Unknown invite returns 500 because `org!.type` is read before the null check.
- **Source/route:** `utils/errorHandler.ts` lacks Zod handling; `validationSchemas/Orders/order.validation.ts`; POST `/api/orders/create`; `auth.controller.ts:146`, POST `/api/auth/join`.
- **Why it matters:** Valid rejections look like server faults; response errors expose internal details. Invalid quantities are nevertheless prevented from becoming orders through the API.
- **Reproduce/evidence:** `invalid-order-quantity-*`, `invalid-invite-code`.

### F11. Submitted Distributor profile fields are discarded

- **Expected:** Fields presented and submitted by the Distributor form persist, or the form indicates they are unsupported.
- **Actual:** Submitted GST number, phone, and country are stripped/not stored; listing returns null placeholders.
- **Source/route:** Frontend `components/distributors/AddDistributorForm.tsx:68`, `lib/backend-api.ts:195`; backend `auth.validation.ts` RegisterOrgSchema, `auth.controller.ts:23`, `Network/network.controller.ts:206`; Organization model has no such columns.
- **Why it matters:** The UI appears to accept business details it cannot retain.
- **Reproduce/evidence:** `register-distributor-owner` submits all three; `submitted-distributor-fields-retained` shows null values from GET `/api/network/distributors`.

### F12. Termination policy is only partially enforced

- **Expected for strict lifecycle gating:** Terminated upstream agreements prevent further fulfillment dependent on them, or an explicit policy permits grandfathered orders/downstream contracts.
- **Actual:** New upstream REQUEST is rejected after termination; an existing UNDER_REVIEW order is still approved. Existing Distributor -> Partner agreement stays ACTIVE and supports new allocation/payment/dispatch/delivery. Creating a new downstream agreement fails because no active company agreement exists.
- **Source/route:** `Agreement/agreement.controller.ts:125`; `Orders/orders.controller.ts:54,228,447,502`; `Agreement/agreement.controller.ts:10`.
- **Why it matters:** Termination affects creation and fulfillment inconsistently. **Policy gap requiring a business decision**, rather than an unconditional claim that fulfilling every pre-existing order is wrong.
- **Reproduce/evidence:** `company-terminate-upstream`, `new-order-after-upstream-termination`, `old-request-approved-after-termination`, `downstream-allocation-after-upstream-termination`, `new-downstream-agreement-after-upstream-termination-denied`. The downstream eligibility test used an explicit stock fixture to isolate agreement rules.

### F13. Browser callers do not implement the complete lifecycle

- **Expected:** A person can finish the lifecycle through the current application if end-to-end means the shipped UI.
- **Actual from source inspection:** Distributor creation/listing use actual backend endpoints. `app/(dashboard)/orders/page.tsx` renders `PlaceholderPage`; `lib/dashboard-data.ts` and `components/dashboard/RecentOrders.tsx` provide mock order displays. Search of frontend TS/TSX found no agreement/order mutation callers and no network initiate/accept callers; only network request listing and Distributor listing are wired.
- **Why it matters:** Successful direct-API tests do not establish a usable browser workflow.
- **Verification:** Source inspection and route/caller search, not automated browser execution. No UI modifications made.

## D. Critical verified bugs

Prioritize these demonstrated security/data-integrity failures:

1. **Agreement relationship bypass (F2):** mismatched networks and invalid/self organization relationships become ACTIVE and authorize orders.
2. **Duplicate stock commitments (F4 and R1):** one kiosk belongs to multiple approved active orders through status mutation or concurrent approval.
3. **Incorrect ownership transfer (F5):** a stale supplier order overwrites the kiosk's newly established owner.
4. **Duplicate active assignment history (R4):** two concurrent deliveries both succeed and leave two open ledger records.
5. **Missing server role authorization (F1):** company/distributor MANAGER/STAFF can perform mutations expected to be privileged.
6. **Conflicting active agreements (F3/R6):** multiple drafts become active for the same Partner.
7. **Changed monetary terms (F8):** fractional deposit values silently lose precision.

Invoice paths, notification failure recovery, and deletion/validation response defects are also verified functional bugs, but are listed separately from the highest-impact integrity cases. Termination and upstream fixed-share policy questions are not counted as unconditional critical bugs.

## E. Race conditions

The harness first holds a real PostgreSQL row/table lock, launches both HTTP requests, observes both waiting in `pg_stat_activity`, releases the lock, then inspects responses and persisted rows. The code under test is not modified to introduce a delay. These demonstrate valid overlapping schedules; they do not measure how often production timing would hit them.

| ID / scenario | Actual result | Mechanism and evidence |
| --- | --- | --- |
| R1. Two orders reserve the same available stock | **200 + 200**, both APPROVED, identical kiosk in both OrderKiosk sets | `reserveKiosks` reads without locking and ignores conditional `updateMany` count. Second transaction updates zero kiosks but still attaches them. `two-reservations-*`, `concurrent-reservations-do-not-share-kiosk`. |
| R2. Two approvals of the same order | **200 + 500** | Both read UNDER_REVIEW; one then hits composite OrderKiosk uniqueness. Second transaction rolls back, so this test did not leave duplicate rows for that one order. `two-approvals-same-order-*`, `same-order-after-race`. |
| R3. Concurrent new order numbers | **201 + 500** | Both read last order number, compute same next number, then race on unique orderNumber. Unique index prevents duplicate numbers but one otherwise valid request fails. `order-number-race-*`, `concurrent-new-orders-both-succeed`. |
| R4. Two deliveries of one order | **200 + 200**, two active child assignments | Both pre-read DISPATCHED. Second history-closing statement's snapshot does not include first transaction's new ledger row, then inserts another. `concurrent-delivery-*`, `concurrent-delivery-one-active-assignment`. |
| R5. Duplicate network initiation | **201 + 201**, two same-pair rows | Existence check and insert are separate; no pair uniqueness. `duplicate-network-creation-*`, `concurrent-network-pair-unique`. |
| R6. Concurrent agreement drafts | **201 + 201**, both later ACTIVE | No unique pending/active relationship rule and no approval-time exclusivity check. `duplicate-agreement-creation-*`, `concurrent-agreements-only-one-active`. |
| R7. Concurrent connection acceptance | **200 + 200**, one ACTIVE row | Update filters by id after PENDING check outside a transaction. Repeated side effect was not observed; currently redundant success, not proven corruption. `concurrent-connection-accept-*`. |
| R8. Concurrent approval of one agreement | **200 + 200**, one ACTIVE row | Same check/update pattern; effectiveFrom/updatedAt can be written twice. This alone did not produce duplicate agreements. `concurrent-agreement-approval-*`. |
| R9. Kiosk status change during delivery | Retirement returns **200**; delivery returns **200**, final AVAILABLE/child-owned | Delivery waits on assignment history while actual PATCH changes kiosk status; delivery later overwrites it. `concurrent-kiosk-retirement`, `concurrent-state-change-overwritten`. |

Sequential retry of identical order bodies also creates distinct orders (`duplicate-order-body-first/second`). No idempotency key is implemented. This is a retry-safety gap; identical payloads can also represent legitimate separate orders, so duplication alone is not classified as corruption.

## F. Missing protections and database integrity

### Constraints that were actually enforced

Rollback-only SQL probes confirmed:

- Second COMPANY violates custom `only_one_company` partial unique index: SQLSTATE **23505**.
- A second membership for the same user violates `Membership_userId_key`: **23505**.
- Nonexistent `Kiosk.currentOrgId` violates FK: **23503**.
- Negative deposit and negative non-refundable agreement amounts violate their custom CHECK constraints: **23514**.

Database metadata confirms foreign keys across users, organizations, memberships, networks, agreements, orders, kiosks, and assignments; unique user email, invite code, machine code, external device ID, refresh hash, reset hash, order number; composite `(orderId,kioskId)` uniqueness; and nonunique assignment lookup indexes.

### Assumptions the schema does not enforce

| Assumption | Current protection / verified gap |
| --- | --- |
| One network relationship per org pair | No unique pair constraint; duplicate concurrent inserts observed. |
| Agreement endpoints match its connection | Independent FKs prove each referenced row exists, not that IDs belong together. Invalid relationships accepted by HTTP. |
| Valid parent/child org types, distinct IDs | Enum validates each organization's type, not hierarchy between rows. Self/invalid-type agreements accepted by HTTP. |
| One valid active Distributor agreement per Partner | No appropriate unique active/pending relationship constraint; two active agreements observed. |
| One kiosk per active reservation/order commitment | OrderKiosk uniqueness is per order/kiosk pair only. Shared kiosk across two active orders observed. Historical reuse is legitimate, so a blanket unique(kioskId) on OrderKiosk would be incorrect. |
| One open assignment per kiosk | Existing indexes are nonunique. Concurrent delivery creates two open rows. |
| Ledger organization equals current kiosk owner | No such DB constraint; rollback probe changed open ledger org independently. Application must coordinate them transactionally. |
| Order parent/child agree with its Agreement | Independent FKs only. Rollback probe changed order parent to another existing org successfully. |
| Shares total 100 | Zod/controller check only. DB accepted 99 + 99 in a rollback probe. |
| Positive order quantity and consistent totals | No CHECKs. DB accepted quantity -1 and grandTotal -100 in rollback probes. Public quantity validation blocks invalid inserts but returns the wrong HTTP status. |
| Exact monetary storage | Shares Decimal(5,2), agreement amounts Int, order financials Float/double precision. Fractional agreement input truncation was reproduced. Floating-point rounding risk was inspected, but a distinct incorrect ordinary integer-based order total was not reproduced. |
| Serialized state transitions | Order state checks precede transactions. Network/agreement approval check and update are separate. Real overlap tests demonstrated resulting failures. |

### Authorization coverage

| Operation | Correct actors observed | Negative coverage and gaps |
| --- | --- | --- |
| Create Distributor / Partner | Company OWNER and ADMIN; Distributor OWNER and ADMIN for Partner | No cookie and inactive membership denied; Partner denied; Distributor cannot create Distributor. Company/Distributor MANAGER and STAFF incorrectly allowed. |
| Network initiate/accept/delete | Company/D OWNER initiate; Company ADMIN initiate; receiver OWNER/ADMIN accept; initiator OWNER deletes unused link | Wrong receiver, company accepting its child request, low roles, wrong initiator, and forbidden hierarchy denied. ADMIN cannot delete. Pair race remains. |
| Agreement create/approve/terminate | Supplier OWNER creates; child OWNER approves; supplier OWNER terminates | ADMIN/MANAGER/STAFF denied; wrong child/parent owner denied. A valid OWNER can still supply invalid relationship/type IDs. |
| Order create/approve/pay/dispatch/deliver | Parent/child OWNER creation according to order direction; parent Company ADMIN fulfillment; Distributor ADMIN downstream allocation and fulfillment | Anonymous, inactive, low roles, unrelated org, child acting as supplier, and Partner-initiated orders denied. Existing state/relationship flaws remain. |
| Kiosk mint/status/read | Company mints; Distributor sees owned inventory; Partner sees owned delivered kiosk; Company global inventory | Distributor/Partner mint denied; unrelated Distributor kiosk access denied; original Distributor cannot read transferred Partner kiosk. Low-role mutations incorrectly allowed; Partner status change denied. |
| Invoice/orders listing | Parent/child access their orders/invoices | Unrelated org denied invoice and sees no unrelated orders; unauthenticated access denied. No extra read-role restriction exists; this was not presumed required. |
| Membership management | Company OWNER/ADMIN with rank restrictions | Admin cannot grant ADMIN; OWNER can approve ADMIN; lower roles cannot manage. Pending/rejected memberships blocked from business routes. Public downstream member administration is absent. |

The role matrix includes repeated actual requests across all mutation categories for anonymous, PENDING, REJECTED, company/distributor/partner MANAGER and STAFF identities. OWNER/ADMIN positive actions and ownership-specific negatives are covered separately rather than assuming a 403 always proves the intended controller check ran.

## G. Complete end-to-end scenario

**PASS for the normal serial API scenario with captured successful email transport.**

Verified sequence: Company creates Distributor -> Distributor ACTIVE OWNER -> network ACTIVE -> company agreement ACTIVE -> Distributor requests and receives two kiosks -> Distributor owns them -> Distributor creates Partner -> downstream network ACTIVE -> downstream agreement ACTIVE -> Distributor allocates and delivers one of the Company-origin kiosks -> Partner owns it.

The snapshot evidence checks:

- The order's exact kiosk IDs, reservation status, parent ownership before delivery, and financial/invoice snapshot.
- Company -> Distributor: currentOrgId changes, AVAILABLE, location null, previous open company assignment closes when one exists, exactly one new Distributor assignment references the upstream order and acting user.
- Distributor -> Partner: the same Company-origin kiosk transfers, Distributor assignment closes, new Partner assignment references the downstream order, and Partner-only ownership is reflected in scoped reads.
- Unrelated Company inventory remains unchanged in this scenario.

Evidence: `upstream-reserved-snapshot`, `upstream-dispatched-snapshot`, `upstream-delivered-snapshot`, `downstream-delivered-snapshot`, `company-distributor-partner-chain`, `unrelated-kiosks-unchanged`.

This serial success does **not** negate the failed authorization, relationship, concurrency, and manual state-change cases. The complete requested lifecycle is not correct under those conditions.

## H. Smallest focused fixes

No application fixes or schema mutations were applied to existing databases during this audit.

1. **Add explicit role gates** to registration, batch creation, and kiosk status mutation, matching the agreed OWNER/ADMIN policy. Keep org scoping in controllers.
2. **Validate agreement relationships in one place:** active connection endpoints equal the proposed parent/child; IDs differ; allowed pairs are COMPANY->DISTRIBUTOR/PARTNER and DISTRIBUTOR->PARTNER. Repeat relevant checks on approval under transaction protection.
3. **Enforce agreement exclusivity at approval, not only creation.** Serialize competing approvals for a child and add a schema constraint representing the chosen active/pending exclusivity rule. Because parent org type is in another table, use a deliberate schema representation or transaction lock; do not write an invalid cross-table partial-index predicate.
4. **Make stock reservation atomic.** Lock/select eligible stock with a deterministic order (`createdAt`, `id`), use `FOR UPDATE`/`SKIP LOCKED` as appropriate, verify exactly quantity rows were reserved, and roll back on shortage. Store the reserving order identity, or add explicit active reservation rows with uniqueness, so status alone cannot identify reservation ownership.
5. **Serialize order transitions inside the transaction.** Lock or conditionally update the order from its expected status/payment state; revalidate kiosk owner, status, reserving order, and quantity before dispatch/delivery. Ensure all kiosk mutation paths use compatible checks.
6. **Protect ledger uniqueness** with a new partial unique index on kioskId where assignedTo IS NULL, after examining/reconciling any existing duplicates. Keep history closure, new rows, ownership change, and order completion atomic. Do not add global unique(kioskId) to historical OrderKiosk rows.
7. **Restrict direct kiosk transitions.** RESERVED/ASSIGNED are controlled by orders; active reservations/in-transit stock cannot be manually released or retired. Decide explicit valid maintenance/install/return/retirement transitions.
8. **Replace last-order-number lookup with a database sequence/counter**, with appropriate transaction use and uniqueness conflict handling. Consider idempotency keys for client retry safety.
9. **Separate committed business success from notification status.** Persist an email/outbox job with the operation and support retry; at minimum return committed success with notification failure status. Provide a secure credential/invitation resend path. Preserve actual invoice errors distinctly from mail delivery errors.
10. **Correct invoice URLs** to the real protected `/api/orders/:id/invoice` endpoint and verify frontend usage.
11. **Align monetary validation/storage.** Minimal fix for present Int columns: require `.int()` and reject fractional input. If fractional currency is required, use minor-unit integers or Decimal consistently and migrate carefully. Clarify whether fixed 60/40 applies upstream too.
12. **Return deliberate validation/conflict responses:** handle ZodError as 400, check invite lookup before accessing it, and reject deletion of any referenced connection (or implement logical disconnection) without physical history loss.
13. **Define termination semantics** for existing orders and downstream contracts, then enforce the selected rule consistently at creation and state transitions. Do not cancel paid/fulfilled obligations implicitly.
14. **Align frontend contracts and checkout schema.** Persist supported profile fields or remove unsupported inputs; implement actual network/agreement/order callers if UI completion is required. Reconcile the two remote-only migrations through source control before treating this checkout as the full deployed backend. Do not overwrite or reset the deployed schema.

## Reproduction and artifacts

From the repository root, with the existing local Docker PostgreSQL running:

```powershell
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```

Each invocation creates a **new** `arcadelx_audit_<timestamp>` database, applies the repository's existing migration SQL there, runs all four phases, and saves a new evidence directory. It does not reuse/reset/delete the existing application database. It reads the configured database's schema metadata if accessible; credentials are read from environment and are not written to the evidence. It captures mail locally and closes its temporary HTTP server after completion. Audit databases and generated PDFs remain available for inspection.

`AUDIT_PHASES` can restrict phases for harness development, but negative/concurrency/integrity phases depend on happy-path context. The primary complete run exited successfully; individual `MISMATCH` entries intentionally record observed defects and policy disagreements, not a count of unique bugs.

- [Primary evidence](20260929071045080/evidence.json)
- [All HTTP outcomes](HTTP_RESULTS.md)
- [Latest execution log](latest-run.log)
- [Untouched local DB schema snapshot](20260929071045080/source-local-schema.sql)
- Primary generated invoices: `20260929071045080/invoices/`

Remaining unverified areas: real external email delivery; full browser interaction; mutation tests against Supabase; behavior of the two absent transaction migrations; extended load/soak testing; gateway payment settlement. These limits do not weaken the concrete bugs reproduced against the current repository implementation and its matching lifecycle constraints.

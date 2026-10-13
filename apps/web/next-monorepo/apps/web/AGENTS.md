<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Maintenance hidden (2026-10-07)

The Maintenance kiosk status is hidden from the UI for now, at the owner's request. Two
surfaces changed, both in the web app only:

- the **Overview stat card** (`components/dashboard/StatGrid.tsx`) no longer renders, and its
  now-unused `Wrench` import and `summary["MAINTENANCE"]` lookup were removed; the loading
  skeleton drops from 6 placeholders to 5 so the grid stays consistent.
- the **kiosk status picker** (`components/kiosks/KioskDetailDialog.tsx`) no longer offers
  `MAINTENANCE`, so the status cannot be set from the UI.

Deliberately kept, so nothing breaks:

- `STATUS_META.MAINTENANCE` in `components/dashboard/ui.tsx`. A kiosk that is already in that
  state must still render a correct badge; removing the meta entry would leave an undefined
  label.
- `KIOSK_STATUSES` in `lib/backend-api.ts`, which mirrors the API enum. `InventoryBreakdown`
  filters out statuses with a zero count, so the Fleet composition donut needs no change and a
  kiosk in Maintenance would still appear there.
- The API, the enum and existing rows are untouched: this is a presentation change only, so
  restoring it is removing the hidden card line and the commented-out `<option>`.

Verified in the running app: the Overview row shows exactly Total Kiosks, Available,
Installed, Pending Members and Network Requests with no Maintenance card and nothing
misaligned; the Fleet composition donut still renders; and the status picker offers
AVAILABLE, RESERVED (disabled), ASSIGNED (disabled), INSTALLED, RETURNED, RETIRED only.
Evidence: `audits/health/overview-no-maintenance.png`.

## Network data-path fixes (2026-10-07)

Two defects in the bell/stat-card network path, both found while investigating a reported
"Network Requests freeze" (which I could not reproduce -- see below):

1. **The bell and the dashboard stat card shared one React Query key but called different
   functions.** The bell used `["networkRequests", 1, 1]` with `fetchReviewRequests("network")`
   (returns `{ requests, meta }`) while StatGrid used the same key with `fetchNetworkRequests`
   (returns `{ data, meta }`). With one cache entry and two shapes, the stat card read the
   other function's field: measured with exactly one pending request, the bell correctly showed
   `Notifications (1)` while the card showed **"Network Requests 2"** -- the total connection
   count, not the pending count. The bell now owns `["review-requests", "network", 1, "header"]`.

2. **The paging helpers could loop unbounded.** `fetchReviewRequests` and the three other
   walkers looped `while (page <= totalPages)`, so a response reporting `totalPages: 0` or
   omitting `meta` left the exit condition resting on arithmetic alone. The bell polls these
   every 10 seconds, so an unending walk could hang the tab -- the most plausible reading of a
   "freeze". All four walks now clamp `totalPages` to at least 1 and stop at `MAX_PAGES` (100).

Verified after the fix: with one pending incoming request the bell and the card both report
**1**; API and web TypeScript pass; ESLint is clean; the production build compiles; and the
three UI suites pass (28 + 19 + 16) with 0 console errors.

**Not reproduced:** every network endpoint answered in 28-63 ms, `/requests` loaded in 781 ms
in both the ACTIVE and PENDING states, `Accept`/`Reject` rendered and responded, 11 seconds of
polling produced 3 calls (a steady 10-second interval), and there were no console or page
errors. A malformed page/limit was rejected instantly with 400. So no freeze was observable;
the two fixes above are real defects found on the way, and fix 2 is the one that could cause a
hang under responses the current server does not produce.

## Notifications and the delivery outbox (2026-10-07)

There is **no push infrastructure** and no notification table: no websocket, SSE,
service worker or push provider anywhere in the app, and no `Notification` model in
the schema. Everything is poll-based React Query:

| Surface | Polls | Interval |
| --- | --- | --- |
| `Header` bell | `/api/members/requests?page=1&limit=1` | 10s |
| Distributor list | `/api/network/distributors` | 30s |
| Requests page | `/api/network` + `/api/agreements` | 10s |
| `useMe` (Distributor sessions only) | `/api/auth/me` | 30s |

`audits/health/verify-notifications.cjs` records the bell's badge and dropdown text
against the pending-work counts in the database. **Both defects are fixed**, and the bell now polls every queue the API exposes and
lists each with its count and destination:

| Queue | Endpoint | Notice | Links to |
| --- | --- | --- | --- |
| Member requests | `/api/members/requests` | Member requests | `/user` |
| Connection requests | `/api/network` | Connection requests | `/requests` |
| Agreements | `/api/agreements` | Agreements to approve | `/requests` |
| Orders | `/api/orders?status=UNDER_REVIEW` | Orders awaiting approval | `/orders` |

Before the fix it counted member requests alone, so with 2 orders `UNDER_REVIEW` the
measured badge was `null` and the dropdown read *"You're all caught up 🎉"*.

Three details worth keeping:

- **The two request queues use different status enums** -- `NetworkStatus.PENDING` for
  a connection but `AgreementStatus.PENDING_APPROVAL` for an agreement. Reusing one
  filter for both silently drops agreements from the badge.
- **"All caught up" waits for every queue to answer.** An in-flight request otherwise
  reads as no outstanding work; the dropdown shows "Checking for pending work..." while
  any queue it can act on is loading. Disabled queries report `isLoading === false`, so
  a gated queue never blocks that state.
- **Orders are gated on `orderDecisions` first**, because `/api/orders` answers 503
  until the order prerequisites exist; queue requests are gated on Owner/Admin, matching
  the API's own authorization, so a non-reviewer issues none (measured).

The bell shows for `canManageMembers || canReview`, so a Distributor Owner now sees
connection/agreement/order work that previously had no in-app surface at all.

Notifications about decisions therefore do not exist; the recipient learns about a
pending agreement or approved request by opening `/requests` or `/orders`.

**Email delivery does persist durably.** `EmailDelivery` is an encrypted outbox
(AES-256-GCM, key derived from `INTERNAL_API_SECRET`) with lease-based claiming and a
2-minute retry window, covering CREDENTIALS, INVOICE and REVENUE. `attemptDelivery`
returns a boolean and is the only sender; there is no background retry worker, so a
failed send stays queued until an explicit retry. Locally, Mailjet keys are dummies,
so credentials mail cannot actually be delivered -- one invitation is queued with
`attempts = 1` and `sentAt = null` for the `testing123` distributor owned by
`nishitpatel.expertwise@gmail.com`. That is also why invited distributor Owners cannot
sign in locally to approve their own agreements.

Retry coverage is now even: `AddPartnerForm` and `AddDistributorForm` both offer a
resend. `AddDistributorForm` previously only showed a warning toast and continued to the
list, so a Distributor invitation whose mail failed could not be re-sent from the UI even
though `POST /api/auth/organizations/:id/credentials/retry` existed. It now stays on the
form and offers "Resend credentials email", which matters because that Owner needs the
emailed password to sign in and approve their agreement. Invoices can be retried via
`POST /api/orders/:id/invoice/retry`.

## Stack health sweep (2026-10-07)

`audits/health/verify-stack-health.cjs` checks the running local stack read-only:
infrastructure, every API endpoint the frontend uses (as the Company owner and as a
Distributor), and every dashboard page -- HTTP status, failed API calls, console
errors and whether the page renders real data or an empty/placeholder state. It
blocks all non-GET API traffic in the browser, and asserts the row counts are
identical before and after, so it cannot change data.

Current result: **all 15 dashboard pages return HTTP 200 with zero failed API calls
and zero console errors**, and `orderDecisions`, `networkRejection` and
`agreementRejection` are all true. Infrastructure, `/`, `/kiosks`, `/orders`,
`/requests`, `/revenue`, `/distributors`, `/user` and `/settings` render real data.

`/reports`, `/payments`, `/settlements`, `/support` and `/audit-logs` were calling
APIs that do not exist on this backend (`/api/reports/revenue`, `/api/payments`,
`/api/settlements`, `/api/support`, `/api/audit-logs`), so each rendered "Couldn't
load..." with a retry that could never succeed. Those calls are gone: the pages are
**kept** and now render `components/common/PlaceholderPage` -- the same "coming soon"
treatment `/roles` already used -- each naming the exact endpoint it is waiting for.
No mock data is introduced. The screens that made those calls
(`components/reports|payments|settlements|support|audit/`) still exist but are no
longer imported by anything, so they are inert; wire them back up when the endpoints
land. Note Reports also fetched distributors successfully, but that list only
rendered alongside the dead report, so it went with it.

`/partners` shows a permission message for a COMPANY, which is correct. These five
pages are linked from nowhere in the sidebar, so they remain reachable only by URL.

Also verified in this sweep:

- **Orders cannot be rejected from the UI.** `OrderStatusDialog` renders only the
  next forward step, so an `UNDER_REVIEW` order offers `Approve` alone even though
  the API exposes `PATCH /api/orders/:id/reject` and the screen imports
  `DecisionDialog`. Orders accumulate unless the API is called directly.
- **No bulk status update exists** for orders; each order is advanced one step per
  request through its own row action.
- `/api/members` and `/api/roles` return 404, though `lib/backend-api.ts` has
  helpers (`fetchMembers`, roles helpers) that call them. The Settings member-invite
  dialog works because it only needs `/api/members/generateInviteCode` and
  `/api/members/requests`, both of which exist.

## Order status progression (2026-10-07)

The API already implemented the whole post-approval lifecycle, but the orders table
rendered only an **Approve** button, so an approved order could never move again:
there was no UI and no `lib/backend-api.ts` helper for payment, dispatch or delivery.
`OrderStatusDialog` now renders the single next valid step for each supplier-side row
and `markOrderAsPaid` / `dispatchOrder` / `deliverOrder` call the existing endpoints.

The chain and its gates (the API re-checks all of them, so a stale row cannot fire an
out-of-order transition):

| Row state | Offered | Effect |
| --- | --- | --- |
| `UNDER_REVIEW` | Approve / Reject | Reserves kiosks, queues the invoice |
| `APPROVED` + unpaid | Mark as paid | Records payment, ready to dispatch |
| `APPROVED` + paid | Dispatch | Kiosks `RESERVED` -> `ASSIGNED` |
| `DISPATCHED` | Mark delivered | Ownership moves to the recipient, kiosks cleared to `AVAILABLE` |
| `DELIVERED` | nothing | Terminal |

`UNDER_REVIEW` rows also offer **Reject**, which the table previously could not reach
even though `PATCH /api/orders/:id/reject` existed; rejection is terminal and leaves
stock and payment untouched. It is gated on `UNDER_REVIEW` + `PENDING` because the API
refuses a decision from any other state.

Notes: steps are supplier-side only (`order.parentOrgId === organizationId`), matching
the API's `lockedOrder` check, so Requesters see no controls. `OrderStatusDialog` reads
the *selected* action rather than assuming one step: Radix fires `onOpenChange` after a
trigger's own `onClick`, so clearing the selection on open would leave the confirm
button with no action to run. Payment verification is a
recorded decision, not a gateway call -- the confirmation says so explicitly, since the
API merely sets `paymentStatus`. Delivery is what transfers kiosk ownership, so the
dialog states that it cannot be undone here.

`audits/distributor-agreement/verify-order-lifecycle.cjs` drives all three steps in a
real browser on an isolated order and asserts both the offered button and the persisted
order/kiosk state at every stage, then restores the database.

## Dashboard revenue trend (2026-10-07)

`RevenueTrendChart` renders on `/` for revenue-authorized memberships
(`useMe().canViewRevenue`), placed between the stat cards and the fleet/recent-kiosk
grid, so unauthorized roles issue no request. It is a single reusable client
component: a recharts `AreaChart` (recharts is already a dependency — no new
packages), a 7D/30D/3M/1Y filter in the panel header, the range total in Indian
currency format, and loading (`Skeleton`), empty (`EmptyState`), and error
(`ErrorState` with retry) states. Chart animation honours `prefers-reduced-motion`.
Data comes from `fetchRevenueSeries(range)` in `lib/backend-api.ts`; nothing is
hardcoded. The pre-existing `components/dashboard/RevenueAnalytics.tsx` and
`widgets/*` charts remain unused and still read mock data — they were left alone.

`scripts/revenue-trend-ui-check.tsx` covers all four states, range switching and
its request payloads, INR formatting, the accessible chart summary, retry recovery,
and role gating with mocked HTTP. jsdom reports a 0x0 container, so rendered chart
geometry is deliberately not asserted; use
`audits/revenue-trend/capture-revenue-chart.cjs` for real browser screenshots (it
inserts temporary rows so the chart has data, then removes them).

### Demo revenue data

`arcadelx_local` had an empty `Transaction` ledger, and revenue is only attributable
inside a kiosk assignment window, so the trend chart showed its empty state. That
gap is now filled: `audits/revenue-trend/seed-demo-revenue.cjs` gave 8 kiosks that
previously had **no** assignment one open assignment beginning ~12 months ago, then
generated ~3 INR transactions per kiosk per day across those windows (8,832 rows,
about 1,095 per kiosk). It is additive only -- all 12 pre-existing assignments were
left byte-identical -- and re-runnable: `--cleanup` removes exactly the rows it
created (assignment ids are `demo-canary-assign-*`, transaction
`externalTransactionId` values are `demo-canary-*`). Run it from the repo root and
check `audits/revenue-trend/demo-seed.json` for what it did.

Because each kiosk's amounts are constant while its transaction count varies
slightly per day, the seeded shape is a realistic plateau with month-to-month and
day-to-day variation rather than a synthetic growth curve; `machine-wise` and the
trend therefore agree on the same totals.

**Current state:** the 12-month history on the 8 synthetic kiosks has been removed
at the owner's request -- their 8 assignments and 8,760 payments are gone. What
remains is 75 payments over three days (25 Sep - 7 Oct 2026): 72 `demo-canary-` rows
on the pre-existing `DEMO-LOCAL-*` kiosks and the 3 real rows imported from the
payment feed. So `7D`/`30D` show three daily buckets and `3M`/`1Y` collapse to a
single week/month bucket -- all still a real line rather than the empty state, but no
longer a 12-month timeline. Re-run the seed script to restore that history.

### Theming

The chart consumes the design tokens as whole values (`var(--primary)`,
`var(--muted-foreground)`, `var(--border)`, `var(--card)`, `var(--card-foreground)`)
because `packages/ui/src/styles/globals.css` defines them as `oklch()` custom
properties. Wrapping a token in `hsl(...)` — as the older `RevenueAnalytics` and
`widgets/*` charts still do — is invalid CSS, so the colour is silently dropped and
the browser default is used; that is why an earlier version of this chart rendered
grey in both themes. Two smaller details: the gradient id is instance-scoped with
`useId` (colons stripped) so two charts on one page cannot share a fill, and
`--primary` is near-black in light but near-white in dark, which suits a line chart
in both.

`audits/revenue-trend/capture-revenue-chart.cjs` screenshots all four ranges in both
themes and records the resolved computed colours. That resolution check is the
meaningful test — the SVG attributes only ever say `var(--token)`, so only the
computed value proves the token resolved and changes with the theme; see
`theme-verification.json`.

## Distributor agreements and the Requests page (2026-10-07)

Distributors now have an **Agreement** action per row in `/distributors`
(`DistributorAgreementDialog`), for COMPANY OWNER/ADMIN only, matching the
Owner-only API decisions. The dialog: sends the network connection request when the
relationship does not exist yet (using the distributor owner email already returned
by `GET /api/network/distributors`), explains pending/declined states, shows the
current agreement, drafts explicit terms (shares must total 100; per-kiosk amounts),
and terminates an ACTIVE agreement. This matters because registration alone creates
no relationship, and `POST /api/agreements/create` requires an ACTIVE connection
whose initiator is the parent.

`/requests` was **not reachable before**: `RequestsScreen` existed but had no routed
page, so a receiver could never approve a drafted agreement. `app/(dashboard)/
requests/page.tsx` plus a sidebar entry (`canReviewRequests`) now expose it.

`scripts/distributor-agreement-ui-check.tsx` covers the permission gate, the
connection-required path, payload shapes for initiate/create, the shares-total-100
rule, termination, and route/sidebar exposure with mocked HTTP.
`audits/distributor-agreement/verify-agreement-flow.cjs` runs the whole cycle in a
real browser against the local stack (connection → draft → approve → terminate) and
deletes exactly the rows it creates. None of that work changed the backend.

## Distributor and Partner requests (2026-10-06)

Orders now exposes Request Kiosks to active Distributor/Partner OWNER/ADMIN.
Partner Owners/Admins also see Orders in the sidebar without gaining other
canTransact capabilities. fetchOrderRequestSuppliers reads every agreement and
network page: Distributors select Company suppliers; Partners select Company or
Distributor suppliers. Both relationships must be ACTIVE and target the requester.
Partner allocation and supplier decisions remain blocked by the API. No migration
is needed. order-request-ui-check.tsx covers permissions and supplier selection.
The existing missing local contact column and disconnected Requests onboarding
page are separate prerequisites; this change does not create relationships.

## Owner contact (2026-10-05)

Local update (2026-10-06): owner-contact migration is now applied to arcadelx_local;
the missing-column registration error is resolved locally. Remote status below
is unchanged.

Distributor and Partner registration require `ownerContact` as a ten-digit string,
matching `/api/auth/register`. Preserve leading zeros and keep organization phone
separate. Partner registration also exposes the existing optional GST field.
`scripts/owner-contact-ui-check.tsx` and `scripts/partner-registration-ui-check.tsx`
cover validation, request payloads and failure recovery with mocked HTTP.
The new contact migration is tested locally but not deployed to Supabase.

## Revenue (2026-10-05)

`/revenue` and its sidebar entry are live for active OWNER/ADMIN/MANAGER memberships
in Company, Distributor and Partner organizations. `useMe().canViewRevenue`
matches the backend role gate. RevenueScreen uses the authenticated fetch wrapper
and user/organization/role-scoped React Query keys with 60-second freshness.
Company OWNER/ADMIN can edit rates; other authorized roles have read-only access.
Company OWNER/ADMIN can also fetch and view the live Mothership payment feed from
`/revenue`; this calls the authenticated read-only `GET /api/revenue/payments` route.
The feed is displayed separately from ledger totals (including pending statuses) and
is not imported into the ledger.
Keep gross revenue separate from statement payouts; no statement download API
is currently exposed. `scripts/revenue-ui-check.tsx` verifies rendering, navigation
cache, permissions, rate validation/saving and errors using mocked HTTP. See
the root `audits/revenue/README.md` for verification and deployment limitations.

## Company member invitations (2026-10-05)

Settings uses `CompanyInviteCodeDialog` with `purpose="members"`. Active Company
OWNER/ADMIN select the invitation's role; ADMIN cannot invite another ADMIN.
The default dialog purpose remains Distributor registration. Internal invitations
link to the existing `/join` route, preserve code case, and activate the invited
member with the Company-selected role. Legacy join codes still require approval.
Join clears the previous session's query cache before redirecting to `/`.
`scripts/member-invite-ui-check.tsx` covers Settings permissions/role selection,
registration submission, cache clearing, and role-based dashboard navigation with
mocked HTTP/router context. Run using the root auth-registration runtime loader.

## Request decisions (2026-09-30)

`/user` is pending Company memberships, with 50-row pagination, ten-second polling
and lower-role-only assignment. Decisions invalidate `pending-members` and
`pendingMembers` prefixes. `/requests` reviews network/agreements and keeps their
history visible; receiving Partner Owners/Admins can review too. Only Owners
decide agreements. `/orders` exposes supplier Owner/Admin decisions only for
unpaid requests under review. Shared `DecisionDialog` confirms the consequence,
submits once and invalidates affected lists even after a stale-decision error.

Use `/api/workflows` availability to disable unsupported writes. The independent
rejection-enum migration is now deployed to Supabase; network/agreement rejection
flags are true and eligible controls enable after the 30-second availability
refetch. Order processing remains unavailable pending its separate migration and
history reconciliation. See `audits/REQUEST_REJECTION_DEPLOYMENT.md` and the root `audits/APPROVAL_REJECTION_FIXES.md`
and `audits/SCHEMA_RECONCILIATION_PLAN.md` for exact status and test evidence.

`scripts/decision-ui-check.tsx` tests real components with an in-memory DOM and
mocked HTTP (jsdom installed under the temp `arcadelx-ui-tests` folder). It is not
a connected-browser visual test. Keep permission gates and safe org-scoped
query keys when changing these screens.

## Model-specific distributor and partner orders (2026-10-13)

Active Distributor/Partner OWNER/ADMIN members request only from their immediate
supplier (Distributor → Company; Partner → Distributor). The dialog fetches live
installed, unreserved model counts from `GET /api/orders/request-models`; it
requires a model, disables models with no available stock, and blocks quantities
above the selected model's count. The request sends `type: REQUEST`, `quantity`,
and `model`. The API independently validates stock and accounts for outstanding
requests, so bypassing the UI cannot request unavailable models.

Approval rechecks and reserves only the persisted requested model. It must fail
with a conflict if that model's stock is no longer sufficient; it cannot silently
substitute a different model. Existing orders with no `requestedModel` retain
legacy any-model approval behavior. The additive migration
`20261013140000_add_order_requested_model` must be applied before deploying this
code; do not claim the feature is deployed while it remains unapplied.

`scripts/order-model-availability-check.tsx` tests model availability, required
selection, quantity limits, request payloads for Distributor and Partner contexts,
and stale-stock rejection using mocked HTTP. `scripts/order-request-ui-check.tsx`
also covers role gates, supplier identity, and model-bearing request submissions.
Both checks are local-only and do not write to a live API or database.

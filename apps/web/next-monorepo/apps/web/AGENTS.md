<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

## Distributor kiosk requests (2026-10-01)

Frontend update (2026-10-05): the action is now labeled Request Containers,
with Number of containers (1–50) and Model type (draft). Model entry is transient
form state only: it is explicitly not saved or sent to the Company, and resets
when the form reopens. The existing quantity-only payload, authorization and
workflow-readiness gates are unchanged. Targeted lint passed; full typecheck
still reports the pre-existing dashboard/ui.tsx KioskStatus mismatch. Updated
component assertions have not been rerun because the test helper is blocked by
the sandbox and the approval service failed in this session.

Orders exposes Request Kiosks to active Distributor Owners/Admins. The dialog
resolves eligible Companies across every page of active agreements and network
connections, checks the current Distributor is the child/receiver, and submits
`POST /api/orders/create` with `type: REQUEST`, `targetOrgId` and integer quantity
1–50. Workflow readiness must allow `orderDecisions`; unknown/error/unavailable
readiness blocks creation. The deployed lifecycle migration is still required
before this control can enable. Success clears filters and refreshes scoped orders.

`scripts/order-request-ui-check.tsx` exercises the real components with mocked HTTP
and the same temporary jsdom installation as the decision checks. It covers
relationship pagination, permissions, validation, readiness, failures, duplicate
submits and successful list refresh without writing to a live API or database.

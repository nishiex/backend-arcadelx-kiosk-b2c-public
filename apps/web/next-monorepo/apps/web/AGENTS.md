<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

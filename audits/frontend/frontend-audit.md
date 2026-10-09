# Frontend & shared-types audit

Audited 2026-10-09. Covers `apps/web/next-monorepo/apps/web` (82 TS/TSX files, ~9,000 lines)
and `packages/shared-types`, plus a live cross-check of the frontend against the running API.
Companion to `audits/backend-improvements/backend-improvement-list.md`, which covers the API.

Method: read the source, then call every endpoint the frontend uses against the local stack
(`localhost:3000` → Next rewrite → `localhost:4000` → `arcadelx_local`) logged in as the seeded
OWNER, and diff the responses against the TypeScript types that describe them.

Both typechecks pass: `tsc --noEmit` exits 0 in `apps/api` and in the frontend.

---

## What is in good shape

Worth stating before the problems, because most of this is deliberate and careful work:

- **No token handling on the client.** The only `localStorage` use is the theme preference in
  `theme-provider.tsx`. Tokens live exclusively in httpOnly cookies, so there is no XSS
  token-theft surface. No `dangerouslySetInnerHTML`, no `eval`, no `new Function` anywhere.
- **Session refresh is well built.** `lib/backend-api.ts:140` single-flights `refreshSession()`
  behind a shared promise with a 15-second `AbortSignal.timeout`, guards against re-entry during
  sign-out, and explicitly skips the refresh for auth routes so a bad credential cannot loop.
- **Unimplemented modules are honestly gated, not faked.** `/roles`, `/support`, `/settlements`,
  `/payments`, `/reports`, `/audit-logs` all render a `PlaceholderPage` naming the missing
  endpoint in its `note`, and `RolesScreen.tsx:27` has
  `const ROLES_BACKEND_AVAILABLE = false` with a comment saying the page is gated rather than
  firing doomed requests. No placeholder data is presented as real.
- **Paging loops are bounded.** `MAX_PAGES = 100` in `backend-api.ts` with a comment explaining
  that the header bell polls those helpers every 10 seconds, so an unbounded walk could hang a tab.
- **Secrets are not committed.** `.env.local` is gitignored
  (`apps/web/next-monorepo/apps/web/.gitignore:2`). The only tracked env file is `.env.example`.

---

## P1 — the frontend calls an endpoint that does not exist

**`registerKiosk` posts to `POST /api/kiosks`, which 404s.** Frontend `POST /api/kiosks` →
**404** (verified live). The backend's kiosk routes are `POST /batch`, `GET /`, `GET /summary`,
`GET /:id`, `PATCH /:id/status`.

`backend-api.ts:529` defines `registerKiosk(input: RegisterKioskInput)` and `:116` defines
`RegisterKioskInput` with `model`, `serialNumber`, `hardwareFingerprint`, `firmwareVersion`.
The function is referenced nowhere else — no component imports it — so it is currently dead
code, not a live bug. It is a trap: it typechecks, it reads as the obvious way to register a
machine, and it will 404 for whoever wires it up next. Either implement `POST /api/kiosks` on
the API or delete the function and its input type.

## P1 — the next 404 will fail silently

**`handleRes` cannot parse a framework-level 404.** `backend-api.ts:127`:

```ts
const handleRes = async <T,>(res: Response): Promise<T> => {
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || 'API Error');
  return json.data as T;
}
```

The Express `errorHandler` always returns JSON, so API errors are handled correctly. But a path
that matches no route at all is answered by Next.js's rewrite layer / the framework's own 404,
which is often HTML or an empty body. `res.json()` then throws a `SyntaxError` from inside
`handleRes`, so the caller gets a parse error instead of "404". Today the six unknown modules are
all caught by the placeholder gating, which is why this has not bitten — the moment any new
screen calls a not-yet-built endpoint, the failure will be misleading rather than obvious.

Fix: read the body defensively (`await res.text()`, then try to parse), and surface
`res.status` in the thrown error.

---

## P2 — types that describe fields the API never sends

The types are hand-written and permissive (all optional), so `tsc` passes while the UI silently
renders blanks.

**`Kiosk` claims five hardware fields the API does not return.** `backend-api.ts:104-115`
declares `serialNumber`, `hardwareFingerprint`, `firmwareVersion`, `manufactureDate`,
`warrantyExpiry`. The live `GET /api/kiosks` returns exactly:

```
id, machineCode, model, status, location, currentOrgId, currentOrg, assignedOrg
```

None of the five are present. `getKiosks` selects `kioskDisplaySelect` in
`controllers/Kiosk/kiosk.controller.ts`, which does not include them. Any UI reading those
fields shows `undefined`. Decide whether the columns should be selected — the schema has them —
or drop the fields from the type.

**`Me.permissions` is declared required but never returned.** `backend-api.ts:81` has
`permissions: string[]` (not optional), and `useMe()` at `hooks/useMe.ts` computes
`const permissions = me?.permissions ?? []`. The API's `getMe` select is `id`, `email`, `name`,
`membership{organizationId,status,role,organization{...}}` — **no `permissions` key at all**
(verified live). The fallback means nothing crashes, and `can()` falls back to role checks, but
the fine-grained permission matrix advertised by `useMe`'s doc comments is inert because the
data never arrives. Note this is tied to the unimplemented roles backend, so it may be intended
as forward-looking scaffolding — if so, make it optional in the type to say so.

**There may be a stale duplicate `KioskStatus` list.** `backend-api.ts:88` declares
`KIOSK_STATUSES` including `'RETIRED'`, and a comment directly below it. An earlier grep for
status lists also matched around line 74. I did not fully disambiguate these two regions; worth
a look, because `RETIRED` is one of the values the backend branch removed and the API currently
still accepts (see the branch-comparison document).

---

## P2 — client-side authorization is the only gate, and must never be the last word

There is **no `middleware.ts`** anywhere in the frontend. Route protection is
`components/dashboard/AuthGuard.tsx`, a `"use client"` component inside
`app/(dashboard)/layout.tsx` that renders children only when `useMe()` succeeds and redirects to
`/login` on error.

That is a correct UX pattern, and the backend does enforce authorization independently
(`requireAuth`, `loadMembership`, `requireRole`, `requireOrgType`), so this is not a hole. Two
consequences to be deliberate about:

1. Every dashboard page still renders its shell and issues its data queries for one frame before
   the guard resolves, and a user with no session briefly sees the dashboard chrome.
2. `useMe()`'s derived flags (`canManageDistributors`, `canReviewRequests`, …) are UI affordances
   only. Anything gated solely by hiding a button is not enforced. The kiosk list is the concrete
   case: `getKiosks` applies `orgType === "COMPANY" ? {} : { currentOrgId }`, so a COMPANY sees
   every kiosk in the database — a frontend audit cannot fix that; it needs the API-side scoping
   already listed as item 5 in the backend list.

---

## P2 — repo and tooling

**Ten UI check harnesses have no test runner.** `apps/web/next-monorepo/apps/web/scripts/`
contains `decision-ui-check.tsx`, `member-invite-ui-check.tsx`, `revenue-ui-check.tsx`,
`revenue-trend-ui-check.tsx`, `order-request-ui-check.tsx`, `distributor-agreement-ui-check.tsx`,
`notifications-and-order-reject-ui-check.tsx`, `partner-registration-ui-check.tsx`,
`owner-contact-ui-check.tsx`, `sidebar-cache-ui-check.tsx`. There is no Playwright/Vitest
dependency and every `test` script in the workspace is the npm placeholder
(`echo "Error: no test specified" && exit 1`). These look like manual-drive harnesses committed
as evidence. They document real verification work, so keep them — but name them as harnesses
(not `*.test.*`) and note in the README how to run one, or they read as dead code.

**Stray generated artifacts are on disk.** `apps/web/next-monorepo/apps/web/.next/` contains
`dev/types/*` and a `tsconfig.tsbuildinfo`. Gitignored, but worth a clean before archiving.

**Framework versions are current and ahead of the API's toolchain.** Next 16.3.3, React 19.2.4,
TypeScript ^5. The API stays on Node-targeted ESM with `tsx`; nothing here conflicts, just note
the frontend is on a newer major than the `/api` project's bundling target (`node22`).

---

## Overall assessment

The frontend is in better shape than the API. Its auth plumbing is genuinely well done — cookie
only, single-flighted refresh, bounded pagination, no injection surface — and the unimplemented
modules are disclosed rather than faked, which is rarer than it should be.

The real problems are not in the frontend at all:

- six backend endpoint families (`/roles`, `/support`, `/settlements`, `/payments`,
  `/reports/revenue`, `/audit-logs`) are referenced by the UI and do not exist, which blocks
  those features on the API side
- `POST /api/kiosks` is called by a function whose only other reference is its own type
- `handleRes` will turn the next framework-level 404 into a confusing parse error
- `User.permissions` is designed into the client but never sent by `getMe`

Order of work: fix `handleRes` first (cheap, prevents the next confusing failure), then decide
`registerKiosk`'s fate, then reconcile the `Kiosk` hardware fields and `Me.permissions` with what
the API actually returns.

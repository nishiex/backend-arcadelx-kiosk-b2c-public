# Branch comparison: `origin/Backend` vs `origin/Frontend-Backend-Merge`

Compared 2026-10-09 against fetched remotes. No working-tree or database changes were made;
this document is analysis plus a port plan.

## 1. Branch heads

| Branch | Head | Date (author) | Subject |
| --- | --- | --- | --- |
| `origin/Backend` | `755c652` | 2026-10-08 19:06 +0530 (pit-15) | Impl:Routes for Return Request Feature |
| `origin/Kiosk-Backend` (default) | `894f27e` | 2026-09-08 23:52 +0530 (pit-15) | clean default branch |
| `origin/Frontend` | `4fb21ce` | 2026-09-24 (nishiex) | RBAC, finance & audit modules… |
| `origin/Frontend-Backend-Merge` | `c254603` | 2026-10-09 10:43 +0530 (zwork) | deploy to Vercel, remove request rejection, harden email delivery |
| local `Backend` (stale) | `35a2bfc` | 2026-09-24 | Impl: Import web frontend (apps/web) from Frontend branch |

`755c652` changes one file, `apps/api/src/routes/Kiosk/kiosk.routes.ts` (+10/−2): adds
`GET /returns/pending`, `PATCH /returns/:requestId/approve`, `POST /:kioskId/return`, and adds
`MANAGER` to `POST /batch`.

Two repository-level issues:

- `origin/HEAD` points at `Kiosk-Backend` (`894f27e`), which is a month stale and shares no
  ancestry with either active branch — it is not an ancestor of `origin/Backend` or of
  `origin/Frontend-Backend-Merge`.
- Local `Backend` at `35a2bfc` is **not** on `origin/Backend`'s lineage; it sits on the Merge
  lineage. `origin/Backend` is 15 commits ahead of it. Anyone working from local `Backend`
  is one month behind on the wrong branch.

## 2. Divergence

Merge base `240a129` (2026-09-23, pit-15). The branches have never been merged:
`origin/Backend` +15, `origin/Frontend-Backend-Merge` +13.

### API endpoints

34 shared. Each side owns endpoints the other lacks:

| Only on `origin/Backend` | Only on `origin/Frontend-Backend-Merge` |
| --- | --- |
| `GET /agreements/my` | `GET /orders/:orderId` |
| `GET /agreements/between` | `PATCH /orders/:orderId/reject` |
| `POST /agreements/broker` | `POST /orders/:orderId/invoice/retry` |
| `GET /kiosks/returns/pending` | `POST /auth/refresh/logout` |
| `PATCH /kiosks/returns/:requestId/approve` | `POST /auth/organizations/:organizationId/credentials/retry` |
| `POST /kiosks/:kioskId/return` | `GET /network/distributors` |
| `POST /auth/logout` | `GET /revenue/series` |
| | `PATCH /kiosks/:id/status` |

### Schema

Backend 17 models, Merge 18.

- Backend only: `KioskReturnRequest`
- Merge only: `OrderSequence`, `EmailDelivery`

`KioskStatus` enum diverges — this is the sharpest conflict:

- Backend: `AVAILABLE RESERVED ASSIGNED INSTALLED MAINTENANCE RETURN_REQUESTED RETURNED`
- Merge: `AVAILABLE RESERVED ASSIGNED INSTALLED MAINTENANCE RETURNED RETIRED`

The merged frontend references `RETIRED` 4 times and `RETURN_REQUESTED` 0 times, so dropping
`RETIRED` breaks the UI. Backend's `RETURN_REQUESTED` is required by its return-request flow.

Field-level conflicts:

| Field | Backend | Merge | Note |
| --- | --- | --- | --- |
| `Organization.gstNumber` | `String?` (TEXT) | `String? @db.VarChar(30)` | Both add it; type differs |
| `Organization.phone`, `.country` | absent | `String?` | Merge only |
| `Organization.isActive`, `.accessVersion` | absent | `Boolean`/`Int` + CHECK constraints | Merge only |
| `User.contact` | `String @unique` (required) | `String? @unique @db.VarChar(10)` | Backend's is nullable-unsafe |
| `NetworkConnection.deletedAt` | `TIMESTAMP(3)` | absent | Backend only, additive |

## 3. The migration conflict (blocker)

Backend has 19 migration folders, Merge 18. The 9 migrations up to `20260922151453` are
byte-identical on both sides, so there is no renumbering problem there. The 10 downstream have
no common ancestor, and the two timelines contain **the same DDL under different names**:

| Table | `origin/Backend` | `origin/Frontend-Backend-Merge` |
| --- | --- | --- |
| `Transaction` | `20260928063729_implement_transactions_schema`, plain `CREATE TABLE` | `20261005180000_integrate_revenue`, `CREATE TABLE IF NOT EXISTS` |
| `RevenueSyncRunLog` | same Backend migration | same Merge migration |
| `RevenueStatement` | `20261005105703_add_revenue_statements_and_system_settings` | same Merge migration |
| `SystemSettings` | same Backend migration | same Merge migration |
| `Organization.gstNumber` | `20261006125855_add_gst_number…` | `20260929100000_protect_distributor_lifecycle` / `20261005121000_restore_registration_fields` |

Merge wrote these defensively (`IF NOT EXISTS`, `DO $$ … IF NOT EXISTS … $$`), so applying
Backend's timeline *after* Merge's would silently no-op rather than fail. Backend's timeline is
not defensive — applied to a database that already has these tables, Backend's plain
`CREATE TABLE` raises `42P07 relation already exists`.

Evidence in the live local database (`arcadelx-pg`, DB `arcadelx_local`): those tables already
exist, and `_prisma_migrations` holds exactly the 17 Merge-timeline rows, including
`20261008120000_remove_request_rejection`. `KioskStatus` in the DB is the Merge variant with
`RETIRED` present.

Two further oddities worth knowing:

- Backend's first divergence commit, `804c513` "Nishit's Not needed Changes", **creates three of
  Merge's migration files** (`20260929100000_protect_distributor_lifecycle`,
  `20260929123000_distributor_access_status`, `20260930070000_request_rejections`). The next
  commit, `2d013c9`, deletes all three and re-authors equivalents under new names/timestamps.
  So Backend transiently carried Merge's migrations and then forked away from them.
- `20261005105703_add_revenue_statements_and_system_settings` and
  `20260928063729_implement_transactions_schema` are empty directories (0 tracked files) on
  Backend — leftover folders from that same untangling.

Timeline collision on the same instant: Backend's `20261008114321_impl_kiosk_return_request…`
and Merge's `20261008120000_remove_request_rejection` are both dated 2026-10-08, resolving
opposite directions on the same feature area.

## 4. Why the port direction is Backend → Merge

The merged frontend (`apps/web/next-monorepo/apps/web/lib/backend-api.ts`) hard-depends on
Merge-only routes:

```
/api/kiosks/${id}/status      /api/orders/${id}            /api/orders/${id}/reject
/api/auth/refresh/logout      /api/network/distributors    /api/revenue/series
/api/orders/${id}/invoice/retry
```

Pointing that frontend at `origin/Backend` 404s on all of them. Conversely Backend's newest
work — the kiosk return-request flow and the agreements `/my`, `/between`, `/broker` routes —
has no frontend caller anywhere, so nothing depends on Backend's route file as-is.

Merge is also the only branch with deploy tooling (`vercel.json`, `apps/api/scripts/build-vercel.mjs`,
`apps/api/serverless/entry.ts`) and with `Agents.md` / `audits/`.

Separately, the merged frontend calls seven endpoint families that exist on **neither** branch —
these are still mock: `/api/roles` (8 refs), `/api/support` (5), `/api/workflows` (4),
`/api/settlements` (3), `/api/audit-logs`, `/api/payments`, `/api/reports/revenue`.

## 5. Port plan

Order matters: migrations must be renumbered before anything is applied.

1. **Drop the duplicated migrations from Backend's side.** Do not carry
   `20260928063729_implement_transactions_schema`, `20260928073023_remove_payu_retries`,
   `20261005105703_add_revenue_statements_and_system_settings`, or
   `20261005113632_add_tds_to_revenue_statement` into Merge. Merge's
   `20261005180000_integrate_revenue` already owns that DDL, including
   `SystemSettings.tdsPercentage` and the `RevenueStatement.finalPayout` / `tdsAmount` columns.
   Delete the two empty Backend folders.

2. **Re-timestamp the migrations that must come across**, so each lands strictly after
   `20261008120000_remove_request_rejection`:
   - `20261006151505_add_delted_at_in_network_connection_for_soft_deletion` → `deletedAt` on
     `NetworkConnection`, additive and non-conflicting.
   - `20261007170801_remove_retired_status…` → **do not port as-is.**
   - `20261008114321_impl_kiosk_return_request…` → `RETURN_REQUESTED` enum value plus the
     `KioskReturnRequest` table. `ALTER TYPE … ADD VALUE` cannot run inside a transaction block
     on older PG; keep it outside `BEGIN`/`COMMIT` or verify on PG 16 first.

3. **Resolve the `KioskStatus` enum as a union**, not a replacement: keep `RETIRED` (frontend
   depends on it), add `RETURN_REQUESTED`. One new migration, both directions.

4. **Resolve the field conflicts explicitly**, preferring Merge's safer definitions:
   - `Organization.gstNumber`: keep Merge's `VARCHAR(30)`; drop Backend's `TEXT` variant.
   - `User.contact`: keep Merge's `String? @unique @db.VarChar(10)`. Backend's
     `ADD COLUMN "contact" BIGINT NOT NULL` would fail on a non-empty `User` table and the
     `BigInt → String` follow-up is churn that Merge avoided.
   - Keep Merge's `phone`, `country`, `isActive`, `accessVersion` and their CHECK constraints.
   - Add Backend's `NetworkConnection.deletedAt`.

5. **Merge the controllers**, not whole files — they have diverged semantically, not just
   textually. Bring Backend's additions into Merge's files:
   - `kiosk.controller.ts`: `getPendingReturnRequests`, `approveKioskReturn`, `requestKioskReturn`,
     and the transaction-based batch create; then reconcile with Merge's
     `PATCH /:id/status` (`updateKioskStatus`), which Backend deleted. Either restore that
     controller or update the frontend caller — decide deliberately.
   - `agreement.controller.ts`: `getMyAgreements`, `getAgreementsBetween`, `createBrokerAgreement`,
     plus Backend's added parent/child connection checks.
   - `network.controller.ts`: `getNetworkHierarchy` and soft-delete on connection deletion.
   - `auth.controller.ts` / `auth.routes.ts` / `utils/token.ts`: `logout` and env-driven expiry.
     Keep Merge's `refresh/logout` route; add Backend's `POST /auth/logout` alongside.
   - `internal.controller.ts`: set `INSTALLED` after pairing.

6. **Schema**: add `KioskReturnRequest` and `User.returnRequests`; add `NetworkConnection.deletedAt`;
   keep every Merge-only model (`OrderSequence`, `EmailDelivery`) and field.

7. **Fix `apps/api/package.json` on Backend's side while porting**: Backend declares
   `cookie-parser` in `devDependencies` but `app.ts` imports it at runtime — it must be in
   `dependencies` (Merge has this right). Backend is also missing `node-cron` and the
   `build` / `start` / `typecheck` / `db:migrate` / `build:vercel` scripts.

8. **Verify**: `npx prisma migrate deploy` against a fresh database built from
   `arcadelx_local`'s 17 migration rows, then `npx tsc --noEmit`, then exercise the frontend
   flows that touch `PATCH /kiosks/:id/status`, `PATCH /orders/:orderId/reject`, and the new
   return-request flow.

## 6. Documentation drift to fix

- The setup note says "all 12 checked-in migrations applied". The local DB
  (`arcadelx_local`, port 5433) has **17**, matching the Merge timeline.
- The note's connection string says database `arcadelx`; `.env` points at `arcadelx_local`.
  Both exist on the container, along with 8 `arcadelx_audit_*` databases.
- `.env.distributors.local`, `.env.local`, and `.env.local-backup-20261005` exist on disk and
  are gitignored.
- `origin/HEAD` still points at the month-stale `Kiosk-Backend`.

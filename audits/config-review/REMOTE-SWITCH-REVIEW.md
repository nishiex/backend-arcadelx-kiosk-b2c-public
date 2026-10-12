# Configuration switch review — proposed `.env` vs. current state

Reviewed 2026-10-12. **No files were changed** and **no writes were made to any database**,
local or remote. The remote inspection below was read-only (schema metadata and row counts).

Scope: the `.env` contents supplied for review, which would move the API from the local
Docker Postgres to the remote Supabase project and change the API port to 3000.

---

## 1. The supplied values are not in `.env`

`.env` on disk is unchanged since **2026-10-07 15:49**. Its current, effective values:

| Key | On disk now | Supplied for review |
| --- | --- | --- |
| `PORT` | `"4000"` | `3000` |
| `DATABASE_URL` | `localhost:5433` | `…pooler.supabase.com:6543` |
| `DIRECT_URL` | `localhost:5433` | `…pooler.supabase.com:5432` |
| `FRONTEND_LOGIN_URL` | `localhost:3000` | `http://localhost:5173/login` |

So nothing has switched, and the observations below describe what *would* happen.

## 2. Credential exposure — rotate these

The supplied block includes live secrets. They should be treated as disclosed:

| Secret | Risk |
| --- | --- |
| Supabase DB password | Full read/write on the remote database |
| `ACCESS_SECRET_TOKEN` / `REFRESH_SECRET_TOKEN` | Anyone holding these can mint valid sessions for any user |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | Can send mail as the verified sender |
| `INTERNAL_API_SECRET` | Authenticates the server-to-server `/api/internal` routes |

Recommendation: rotate all five, then place the new values only in the ignored `.env`
(never in tracked files, tickets, or chat).

## 3. `PORT=3000` breaks the application

| Fact | Evidence |
| --- | --- |
| The frontend already owns port 3000 | pid 37600 listening on 3000 |
| The API currently owns 4000 | pid 23328 listening on 4000 |
| The frontend proxies `/api/*` to the API | `apps/web/next-monorepo/apps/web/.env.local`: `BACKEND_API_URL=http://localhost:4000` |

Consequences of `PORT=3000` as written:

- The API fails to bind (`EADDRINUSE`), because the Next.js frontend holds 3000.
- Even if 3000 were free, the frontend proxy still targets 4000, so every `/api/*`
  call from the browser returns a proxy error.

Changing the API port therefore requires changing `BACKEND_API_URL` in the same step.
`FRONTEND_LOGIN_URL=http://localhost:5173/login` is also wrong for this codebase: 5173
is the Vite dev-server default, whereas this frontend is Next.js on 3000. Production
additionally requires an HTTPS `FRONTEND_LOGIN_URL` (`apps/api/src/config/env.ts`).

## 4. The remote database cannot currently serve this API

Read-only inspection of the configured remote project (session pooler, port 5432):

| Check | Remote result | Consequence |
| --- | --- | --- |
| Migrations recorded | 18 applied | Schema was migrated from a different lineage |
| `Organization` rows | **0** | Nobody can log in |
| `User` rows | **0** | Nobody can log in |
| `Kiosk` rows | **0** | No fleet data |
| `Organization.phone`, `.country`, `.isActive`, `.accessVersion` | **absent** | Registration/profile reads fail |
| `Organization.gstNumber` | present | (only profile column that exists) |
| `User.contact` | `text`, **NOT NULL** | Differs from local, which is nullable |
| `OrderSequence` | **absent** | Order workflow returns 503 |
| `EmailDelivery` | **absent** | Invoice/credential delivery unavailable |
| `Kiosk.reservedOrderId` | **absent** | Order reservation unavailable |
| `Transaction`, `RevenueStatement`, `SystemSettings` | present | Revenue tables exist |

Two concrete failure modes:

1. **Login is impossible** — there are no users to authenticate.
2. **Registration returns 503**, by design: `auth.controller.ts` throws
   `"Owner contact registration is unavailable until the database migration is applied"`
   when the profile columns are missing.

This is consistent with the existing audit trail: `audits/order-readiness/README.md`
records the Supabase database missing the order prerequisites, and
`audits/auth-registration/README.md` records the owner-contact migration being tested
locally but **not** deployed to Supabase.

## 5. Why this was not applied

`apps/api/AGENTS.md` states: *"Do not apply migrations or mutation tests to a configured
remote database by assumption."* Making the remote database usable requires applying
migrations and seeding an owner — both **writes to a remote database** — which is the
class of operation that requires explicit approval rather than inference. It is also
unclear whether this remote project is the intended target or a stale one, given it
carries 18 applied migrations but almost none of the columns this application requires.

## 6. Recommended path

1. **Rotate** the five exposed secrets (section 2).
2. **Decide the target.** If Supabase is intended, plan the migration + seed as its own
   reviewed step; if not, leave `.env` local.
3. **Keep `PORT=4000`** unless the frontend moves off 3000; if it does move, change
   `BACKEND_API_URL` in the same commit.
4. **Correct `FRONTEND_LOGIN_URL`** to the real frontend origin (currently 3000, not 5173),
   and use HTTPS in production.
5. If switching to remote, **re-verify the endpoints** afterwards: the `/api/network`,
   `/api/agreements` and `/api/admin/gateways` paths all depend on columns that the remote
   database does not yet have.

## Verification performed

- `.env` mtime and key/host extraction (values not printed) — confirms no switch occurred.
- Listening-port check for 3000 and 4000.
- `BACKEND_API_URL` read from the frontend's gitignored `.env.local`.
- TCP reachability of the pooler host on 5432 and 6543 — both reachable.
- Read-only remote schema queries via `pg`: migration count, `to_regclass` probes for the
  order/revenue tables, `information_schema.columns` for the profile columns and
  `User.contact`, and row counts for `Organization`, `User`, `Kiosk`.

**Not performed:** any write, migration, seed, or data change against the remote database;
any change to `.env`; any commit or push. Temporary diagnostic scripts were deleted.

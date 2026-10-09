# Vercel deployment — ArcadeLx Kiosk B2C

Status as of 2026-10-07. Everything except the deploy itself is prepared and verified.

## What was found, and why it mattered

**The Supabase migration history had forked from local.** Both sides held 16 migrations but
shared only 9; the other 7 were different on each side, and Supabase lacked `EmailDelivery`
and `OrderSequence` entirely. The previously documented "2 missing migrations" blocker
(`audits/schema-requirements/DEPLOYMENT_BLOCKER.md`) was a symptom of this fork, not a
separate problem.

Two Supabase projects exist:

| Project | Region | State |
| --- | --- | --- |
| `ap-southeast-2` | Sydney | Rebuilt to match local, then **deleted** — superseded by Mumbai |
| `mffixhubskzrdvtpohkd` | Mumbai (`ap-south-1`) | **The deployment target.** Migrated, seeded, verified |

The Sydney project's env backup (`.env.supabase-backup-20261001`) was **deleted on
2026-10-07** at the owner's request, together with its `.git/info/exclude` entry. Its
credentials are therefore gone from this workspace; recover them from the Supabase dashboard
if that project is ever needed again. Only the Mumbai project is live now.

## Supabase now matches local exactly

- 16 migrations applied; `prisma migrate status` reports "Database schema is up to date!"
- Structural diff against `arcadelx_local`: **0 tables differ, 0 column differences**
- Seeded company owner: `nileegames@gmail.com`; company id `cd2f996d-9c97-4ea7-b573-f32c70c161fe`
- `EmailDelivery` and `OrderSequence` now exist, along with `Kiosk.reservedOrderId`

The teammate's `NetworkConnection.deletedAt` column was discarded; `rg deletedAt` across
`schema.prisma` and `src/` returns nothing, so this branch does not use soft-deleted
connections.

## Code changes for serverless

The API could not run on Vercel as it stood. Three distinct blockers:

1. **tsconfig path aliases are not resolved by Vercel's function bundler.** The API imports
   runtime Zod values from `@shared-types/*` (9 files), resolved only through the `paths`
   alias into `packages/shared-types` — a sibling directory that Vercel does not upload, and
   which has no `package.json` so it cannot be installed either.
   *Fix:* `scripts/build-vercel.mjs` bundles `api/index.ts` with esbuild, which does honour the
   alias, inlining first-party code so the alias disappears at runtime. npm packages and the
   generated Prisma client stay external.

2. **`fs.mkdirSync` at module load.** `invoice.pdf.ts` created its directory while being
   imported. On Vercel's read-only filesystem that throws during import and fails the whole
   function.
   *Fix:* the mkdir is deferred to the first invoice write, and the directory defaults to
   `/tmp/invoices` when `VERCEL` is set. `revenue.pdf.ts` likewise defaults to `/tmp/reports`.

3. **`process.exit(1)` in config validation.** An invalid environment would kill the
   invocation with no diagnosis.
   *Fix:* it throws instead, so the real message reaches the logs.

Changed: `api/index.ts` (new entry), `scripts/build-vercel.mjs` (new), `vercel.json` (new),
`src/services/pdf/invoice.pdf.ts`, `src/services/pdf/revenue.pdf.ts`, `src/config/env.ts`,
`package.json` (`build:vercel`, `vercel-build`).

Local development is unaffected: `server.ts` and `npm run dev` are untouched, and with
`VERCEL` unset the invoice and report paths resolve exactly as before.

The frontend needed only `vercel.json`. Its production build was already correct, and
`next.config.ts` proves `BACKEND_API_URL` is required in production (it throws if unset).

## Verification performed

| Check | Result |
| --- | --- |
| Local migration chain replays onto an empty database | All 16 applied |
| `audits/deploy/verify-vercel-bundle.mjs` | **8/8 PASS** — bundle boots from outside the project, `/health` 200, unknown route 404, aliased Zod reachable |
| `audits/deploy/verify-api-against-supabase.mjs` | **7/7 PASS** — production server against Mumbai Supabase: health, DB connected, login 200, authenticated read 200, revenue 200, worker not started |
| Frontend `next build` with `BACKEND_API_URL` set | Compiled successfully, 23/23 pages |
| Supabase vs local schema diff | 0 differences |

## Deploying

Vercel CLI 62.7.0 is installed but not logged in, and no `VERCEL_TOKEN` is present, so the
first step is interactive and must be run by the operator:

```bash
vercel login
```

Two projects, each deployed from its own root directory:

**API** — root `apps/api`:
```bash
cd apps/api && vercel --prod
```

**Frontend** — root `apps/web/next-monorepo/apps/web`:
```bash
cd apps/web/next-monorepo/apps/web && vercel --prod
```

### Environment variables

API (Production):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Mumbai pooler, port **6543**, `?sslmode=require&uselibpqcompat=true&pgbouncer=true` |
| `DIRECT_URL` | Mumbai pooler, port **5432**, `?sslmode=require&uselibpqcompat=true` |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `ACCESS_SECRET_TOKEN`, `REFRESH_SECRET_TOKEN` | From the private local backup (≥64 chars) |
| `INTERNAL_API_SECRET` | From the private local backup (≥32 chars) |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | Real keys — **live sends are possible** |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | `info@nileegames.com`, `ARCADELX` |
| `FRONTEND_LOGIN_URL` | The deployed frontend origin + `/login` — must be `https://` |
| `INVOICES_DIR` | `/tmp/invoices` |

`NODE_ENV=production` activates the strict branch of `config/env.ts`, so every variable above
is mandatory — an unset one now produces a clear thrown error instead of a silent exit.

Frontend (Production):

| Variable | Value |
| --- | --- |
| `BACKEND_API_URL` | The deployed API origin, e.g. `https://<api>.vercel.app` |

Set the API first, then the frontend, then redeploy the frontend once it knows the API origin
(the value is read at build time).

Two `sslmode` notes learned the hard way: `pg` v9 changed SSL semantics, so `sslmode=require`
alone raises `P1011`; `uselibpqcompat=true` restores libpq behaviour. And `pg_dump` cannot
reach the Supabase pooler at all (`no tenant identifier provided` — it needs SNI), which is
why the schema backup was produced over a Node `pg` connection instead.

## Limitations of this deployment

These are inherent to Vercel and are **not** fixed by this work:

1. **Invoice and revenue PDFs do not persist.** `/tmp` is per-invocation, so a PDF generated
   during one request is gone by the next. `GET /api/orders/:id/invoice` will 404 after the
   fact. Persistent storage (Supabase Storage or S3) is needed. Redirecting the directory only
   prevents the import-time crash.
2. **The revenue worker does not run.** `revenue.worker.ts` is a long-lived BullMQ process
   needing Redis; keep `REVENUE_JOBS_ENABLED` unset. Live payment/device sync will not happen
   automatically. `REVENUE_REPORTS_DIR`'s guard also requires an absolute path when revenue
   jobs are enabled in production, which Vercel cannot satisfy.
3. **Cold starts.** The Express app is loaded once per instance and reused, but a cold start
   pays full module cost.

Email sending uses the real Mailjet keys, so a live send is possible from the deployment; none
was triggered during verification.

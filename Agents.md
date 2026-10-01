# Local Development Setup

> Current setup (2026-10-01): both database URLs now use the fresh local database
> `arcadelx_local` on `localhost:5433`, with all 12 checked-in migrations applied.
> The older `arcadelx` database and Supabase were left untouched. Owner setup now
> uses `SEED_*` variables in ignored `.env`; Mailjet has dummy local keys.
> See `apps/api/AGENTS.md` for current verification and private environment backup.
> The six-migration setup notes below describe the original setup.

How the ArcadeLx Kiosk B2C stack runs locally. Current working state as of the latest setup.

## Overview

Monorepo with npm workspaces (`apps/*`, `packages/*`).

| Layer      | Location                        | Port | Notes                                  |
| ---------- | ------------------------------- | ---- | -------------------------------------- |
| Database   | PostgreSQL 16 (Docker)          | 5433 | Container `arcadelx-pg`, DB `arcadelx` |
| Backend API| `apps/api` (Express + Prisma)   | 4000 | `tsx watch src/server.ts`              |
| Frontend   | `apps/web/next-monorepo` (Next) | 3000 | Nested turbo monorepo, own git/node_modules |
| Shared     | `packages/shared-types`         | —    | Zod validation schemas, path-aliased   |

Backend is on **4000** because the Next.js frontend already owns **3000**.

## Environment (`.env` at repo root)

The backend loads `../../.env` (repo root) via dotenv. Required vars validated in
`apps/api/src/config/env.ts`. Current local values:

- `PORT=4000`
- `DATABASE_URL` / `DIRECT_URL` → `postgresql://postgres:devpass@localhost:5433/arcadelx`
- `ACCESS_SECRET_TOKEN` / `REFRESH_SECRET_TOKEN` — generated 64-byte hex secrets
- `INTERNAL_API_SECRET` — generated 32-byte hex
- `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` — dummy values (real email sends will fail; fine for local)
- `NODE_ENV=development`

`.env` is gitignored — not committed.

## Database

Currently a Docker Postgres container (native Windows Postgres on 5432 required a
password not available at setup time):

```bash
docker run -d --name arcadelx-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=arcadelx -p 5433:5432 postgres:16
```

Schema and data applied with Prisma:

```bash
cd apps/api
npx prisma generate        # generates client into src/generated/prisma
npx prisma migrate deploy   # applies all 6 migrations
npx prisma db seed          # seeds the company + owner user
```

Seeded login: `nileegames@gmail.com` / `Nilee@123`

## Database credentials

| Field    | Value       |
| -------- | ----------- |
| Host     | `localhost` |
| Port     | `5433`      |
| User     | `postgres`  |
| Password | `devpass`   |
| Database | `arcadelx`  |

Connection string: `postgresql://postgres:devpass@localhost:5433/arcadelx`

## Running the stack

One-time setup (from repo root):

```bash
npm install
```

Start each service (run each in its own terminal):

```bash
# 1. Database  — start the Postgres container
docker start arcadelx-pg

# 2. Backend API  → http://localhost:4000
cd apps/api && npm run dev

# 3. Frontend  → http://localhost:3000
cd apps/web/next-monorepo && npm run dev
```

Start everything from the repo root in one line (backgrounds DB, then runs API + frontend concurrently):

```bash
docker start arcadelx-pg && ( cd apps/api && npm run dev & ) && ( cd apps/web/next-monorepo && npm run dev )
```

## Frontend ↔ Backend connection

The Next.js app calls the API with relative paths (`fetch('/api/...')`, `credentials: 'include'`).
Those are proxied to the backend via Next rewrites so the browser stays same-origin
(cookies work, no CORS needed):

- `apps/web/next-monorepo/apps/web/next.config.ts` — rewrites `/api/:path*` → `${BACKEND_API_URL}/api/:path*`
- `apps/web/next-monorepo/apps/web/.env.local` — `BACKEND_API_URL=http://localhost:4000`

Verify the proxy reaches the backend:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nileegames@gmail.com","password":"Nilee@123"}'
# → 200 {"message":"Login successful",...}
```

## Health checks

```bash
curl http://localhost:4000/health      # {"data":"OK"}
curl http://localhost:4000/health/db   # {"data":"Database Connected!"}
```

## Notes / gotchas

- `packages/shared-types/validationSchemas/*` were deleted on the `Frontend` branch
  but are imported by the API controllers (`@shared-types/*` path alias in
  `apps/api/tsconfig.json`). They were restored from HEAD so the backend compiles.
  Decide before committing whether that deletion was intentional.
- The email service (`apps/api/src/services/email/email.service.ts`) constructs the
  Mailjet client at module load, so empty Mailjet keys crash startup. Dummy keys in
  `.env` avoid this; supply real keys to actually send email.
- To switch to native Windows PostgreSQL instead of Docker: point `DATABASE_URL` /
  `DIRECT_URL` at `localhost:5432` with the real password and DB name, then re-run
  `prisma migrate deploy` + `db seed`.
- The frontend monorepo's shared packages (`packages/ui`, `packages/typescript-config`,
  `packages/eslint-config`) were staged-but-deleted from the working tree. Without them
  the build fails with `@workspace/typescript-config/nextjs.json doesn't resolve` and
  `Can't resolve @workspace/ui/lib/utils`. They were restored from the git index
  (`git checkout -- packages` inside `apps/web/next-monorepo`), and `npm install` was
  re-run there to install the `next` binary.

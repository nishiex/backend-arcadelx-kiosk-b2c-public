# Production readiness: commit 9b5ef9a

Audited 2026-09-29. **Do not deploy the original commit unchanged to the currently configured database.** The frontend builds, but the database is behind the required schema and contains an order that blocks the new migration. A custom domain is not required for preparation; a hosting provider's HTTPS address can be used initially.

The production setup fixes below are included in the follow-up commit after `9b5ef9a`. They are not part of that original commit. No production deployment, remote data repair, schema change, or external email was performed.

## Findings and disposition

| Priority | Finding | Status |
| --- | --- | --- |
| Blocker | `20260929100000_protect_distributor_lifecycle` is not applied to the configured DB. Registration/order writes require its fields/tables. | Still blocked for that database. |
| Blocker | One APPROVED/DISPATCHED order has a linked-kiosk count that differs from quantity. The migration explicitly raises an exception for this state. | Still requires a reviewed data repair. Do not invent order links or silently cancel the order. |
| Blocker | The configured DB records two migrations absent from the repository: `20260928063729_implement_transactions_schema` and `20260928073023_remove_payu_retries`. | Retrieve the original migration files and reconcile schema/history before deployment; do not fabricate replacement migration contents or reset the database. |
| High | API `cookie-parser` and the TypeScript runtime `tsx` were dev dependencies; no `start` or `build` script was defined. | Fixed locally: runtime dependencies and lockfile updated; build/start/typecheck/migration scripts added. Production-only installation tested. |
| High | The frontend defaulted to localhost when `BACKEND_API_URL` was missing. Turbo did not explicitly carry that environment setting into its build or cache key. | Fixed locally: production requires an explicit valid origin; Turbo declares `BACKEND_API_URL` and `NODE_ENV`. Compiled rewrites and a real API proxy request were checked. |
| High | Invoices used `process.cwd()/invoices`; files disappear on ephemeral hosts and are unavailable on other instances. | Configurable absolute `INVOICES_DIR` added and required in production. The host must mount durable storage; replicas must share it. Config validation cannot prove persistence. |
| Medium | `.env.example` had an invalid PORT entry, missing internal encryption secret, misleading expiry comments and an obsolete login port. | Replaced with a usable placeholder template. Existing `.env` secrets were not edited. |
| Medium | Missing mail settings, insecure production login links and invalid expiry/port settings could fail late. | Added production startup validation. Real Mailjet credentials, verified sender and HTTPS login URL still must be supplied by the operator. |

Read-only DB preflight: [preflight-20260929104811454.json](distributor-lifecycle/preflight-20260929104811454.json). It found exactly one active-order quantity conflict, zero for the other eleven checked conflict categories, no failed migration rows, and the unapplied fix migration. This describes the configured database, not an independently identified production environment.

## Verification performed

- Detached checkout of **exact commit `9b5ef9ad08bbdb0ffac32b5506d76be2e87c62a3`**; separate installs from the root and nested frontend lockfiles. The unrelated local ThemeToggle edit was excluded.
- Original commit: fresh installs succeeded, Prisma schema validation and client generation succeeded, API TypeScript check passed, frontend optimized build generated all 20 static pages. Existing installed dependencies/generated clients were not substituted into this checkout.
- Follow-up changes copied into that checkout: API build passed (`prisma generate && tsc --noEmit`); the nested monorepo's **`npm run build` through Turbo** passed with an explicit backend origin.
- API runtime was reinstalled with **`npm ci --omit=dev --ignore-scripts`** after generating the Prisma client. The production API imported and served real HTTP health/logout routes successfully with this reduced installation.
- **13 production smoke tests passed**: valid configuration, five invalid API configurations, matching Secure/HttpOnly/SameSite cookie creation/clearing, two invalid frontend origins, correct configured rewrite, PDF output in configured storage, production API startup, and built Next frontend → actual production-mode API logout forwarding.
- Tests used synthetic secrets, an unreachable dummy DB URL, local processes and temporary invoice storage. No production login, real external email or database mutation was needed for those smoke tests.
- Frontend typechecking is included in the optimized build. Lint has 0 errors and 62 existing warnings (down from 63 after declaring the build environment variable). Final whitespace checks pass.

The earlier real HTTP/database lifecycle suites are documented in [FIXES.md](distributor-lifecycle/FIXES.md). They exercised isolated PostgreSQL databases. They are not proof that a specific hosting provider, Linux image, network, real mail sender, or existing production dataset has been validated.

## Deployment recipe

Use Node 24 LTS, matching the repository's Node version family. The backend and nested frontend have separate dependency installations. Deploy the follow-up changes as a new reviewed commit, not just the original hash.

### API

Build from repository root with development dependencies installed:

```sh
npm ci --include=dev
npm run build --workspace api
```

The Prisma build needs `DIRECT_URL` set to a valid connection URL; client generation itself does not apply migrations. Keep `apps/api/src/generated/prisma/` in the built artifact. The server runs TypeScript via its runtime dependency `tsx`; a compiled `dist/` is not produced. Include source files, `apps/api/tsconfig.json`, shared validators under `packages/shared-types/`, and `apps/api/src/assets/arcadelx-logo.png`.

After the schema/history and data blockers are reconciled, back up the target DB and run the release migration step with the build tools available:

```sh
npm run db:migrate --workspace api
```

Do **not** run this against the current configured database until the blockers above are resolved. Test the upgrade against a restored staging copy first. A new empty database can use the repository migration sequence, but that does not repair existing production data/history.

If desired, prune build-only dependencies after generation and the release migration step, then start:

```sh
npm prune --omit=dev
npm start --workspace api
```

Required runtime settings:

| Setting | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Host-assigned TCP port, or default 4000 |
| `DATABASE_URL`, `DIRECT_URL` | Correct runtime/migration connection URLs for that environment |
| `ACCESS_SECRET_TOKEN`, `REFRESH_SECRET_TOKEN` | Independent secrets, at least 64 characters each |
| `INTERNAL_API_SECRET` | At least 32 characters; stable across restarts/replicas while encrypted delivery jobs exist |
| `ACCESS_EXPIRY`, `REFRESH_EXPIRY` | Use supported defaults `15m` and `7d`; existing refresh DB expiry remains fixed at seven days |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | Actual provider credentials |
| `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | Verified sender and display name |
| `FRONTEND_LOGIN_URL` | Public HTTPS login URL; provider subdomain is sufficient |
| `INVOICES_DIR` | Absolute writable path on persistent storage, e.g. `/var/lib/arcadelx/invoices` |

Persist/mount the invoice directory across releases. Use one API instance until shared invoice storage is configured. Existing invoices must be migrated into this directory as part of deployment; changing the setting alone does not copy files. Do not point it at the audit/test PDF directories.

### Frontend

From `apps/web/next-monorepo`:

```sh
npm ci --include=dev
npm run build
npm run start --workspace web
```

Set `BACKEND_API_URL` before **both build and start**. It is an HTTP(S) origin only, such as `https://api.your-host.example`, without `/api`, credentials or a query string. An internal HTTP origin is acceptable only behind trusted infrastructure; the browser-facing site needs HTTPS. Build-time rewrites are baked into the artifact: rebuild when the API origin changes. It is not a `NEXT_PUBLIC_` secret or browser-direct API setting.

Expose the frontend through HTTPS and keep browser API requests on its `/api/*` proxy. Cookies are HTTP-only, SameSite Strict and Secure in production. Direct browser calls to a separate API origin are not supported by the current default CORS setup. Do not loosen cookie flags to make plain HTTP production login work.

Before public launch, configure TLS, authentication endpoint rate limiting at the proxy/host, backups/restore, process restart supervision and monitoring. Confirm `/health/db`, real HTTPS login → refresh → logout, assignment visibility, invoice download after a restart, and a consented test email on the actual host. `/health` alone only checks that the process is responding.

## Known scope limits

- No host, TLS certificate or public URL has been selected. Therefore real HTTPS browser cookie behavior, Linux deployment and actual mail delivery remain unverified on the final infrastructure.
- Email failure recovery is explicit via retry endpoints; no automatic background retry worker was added. Keep the encryption secret stable.
- The old Fleet composition code only enumerates `AVAILABLE` in its status list even though the backend supports more states. This existing UI limitation was identified, not changed during production setup; the user's reverted Fleet composition design remains intact.
- The Orders frontend is still a placeholder; production setup does not add the missing full commercial lifecycle UI. Backend lifecycle coverage does not imply the complete workflow is available through screens.
- Existing authentication limitations documented in the backend guide (including refresh expiry/rotation behavior and access JWT lifetime) were not redesigned in this preparation. This is not a full security penetration test.

Re-run production smoke checks against an isolated checkout with generated Prisma client and installed dependencies:

```sh
node audits/distributor-lifecycle/production-runtime.test.cjs /absolute/path/to/checkout
```

For the optional frontend integration test, first build that checkout with `BACKEND_API_URL=http://127.0.0.1:45678`, leave that port free, and add `--with-frontend`. Tests start only local processes and send no external messages.

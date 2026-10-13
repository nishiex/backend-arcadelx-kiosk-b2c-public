# Revenue integration from Backend 2d013c9

The revenue implementation is integrated into the existing API without replacing
Company invitations, order reservation logic, organization access fields or the
frontend. The branch was not merged or reset. Existing uncommitted work remains.

## Capabilities

- `GET /api/revenue/machine-wise`: Company sees the fleet; Distributors see their
  assignment periods and Partner periods covered by their agreements; Partners
  see their own periods. Active OWNER/ADMIN/MANAGER only. Amounts are INR.
- `GET /api/revenue/deduction-rates`: active members can read the current rates;
  defaults are returned without creating a row.
- `PATCH /api/revenue/deduction-rates`: Company OWNER/ADMIN only. Rates are limited
  to 0–100 with two decimal places; GST plus gateway fees cannot exceed 100.
- Completed Mothership transactions map by external device ID, with machine-code
  fallback. The unique transaction ID makes replay/concurrent imports idempotent.
  Invalid records produce a failed sync log; unmatched devices are counted.
- Company Owners/Admins can read the live Mothership payment feed through
  `GET /api/revenue/payments` from `/revenue`. This read-only route displays all
  returned statuses separately from ledger totals and does not import or mutate
  transactions. The separate `syncRevenueData` importer is reserved for the scheduled
  pipeline when enabled.
- Monthly statements use Indian calendar boundaries, assignment history and
  agreements effective at each transaction. Money uses Decimal arithmetic, with
  transaction-level rounding to paise. Existing source GST/fee/share formulas are
  retained. The database stores monthly totals and the PDF path.
- Statements and their encrypted email jobs commit together. The existing
  EmailDelivery lease/retry mechanism handles email failures after persistence;
  retries do not recreate a statement or resend a successfully recorded delivery.

## Runtime

Existing BullMQ supplies both schedules and the worker; node-cron is unnecessary.
The API loads environment configuration before starting either. Set:

```dotenv
REVENUE_JOBS_ENABLED=true
REDIS_URL=redis://localhost:6379
MOTHERSHIP_TRANSACTION_API_URL=https://your-configured-source/transactions
REVENUE_REPORTS_DIR=/absolute/persistent/report-directory
```

Jobs default to disabled. Enabling starts nightly sync at midnight Asia/Kolkata
and monthly statement queuing at 02:00 on the first day. Each organization/month
gets a distinct queue job ID; delayed/retried scheduler jobs retain their intended
month. Only active Distributor/Partner organizations are queued. Ensure the
existing Organization access fields are present before enabling workers.
The report directory must be absolute in production. HTTP routes do not require
Redis while workers are disabled. Existing Mailjet configuration is reused.

## Migrations

`20261005180000_integrate_revenue` is an additive compatibility migration. It was
tested on a new local database and repeated against populated revenue tables.
No remote migrations were applied during this integration. A database with older
nonempty statements but no TDS/payout columns fails rather than inventing financial
history. Existing Company profile/access/order fields are retained.

The four original upstream SQL files are retained under `upstream-migrations/`
for history reconciliation. They are not blindly replayed: the upstream revenue
migration repeats rejection enum additions already present in this codebase,
and its earlier migration drops an obsolete transaction column.

## Verification

From repository root:

```powershell
npx.cmd tsc --noEmit -p apps/api/tsconfig.json
node -r ./audits/auth-registration/runtime-loader.cjs audits/auth-registration/verify.cjs
```

The combined harness creates a new local PostgreSQL database and captures all
email in memory. It tests existing auth/invite flows plus import deduplication,
invalid input, revenue scoping, permissions, settings, agreement changes, kiosk
transfers, month boundaries, payout amounts, PDF creation, failed email recovery,
concurrent/repeated statement requests and non-destructive migration repetition.
Evidence is in `../auth-registration/verification.json`. Redis scheduling is
typechecked and its period/ID helpers tested; no live background schedules or
Mothership imports were enabled. PDF generation is tested, not browser visual QA.

The integration run passed all 179 harness checks, API typechecking and Prisma
validation. Read-only checks through the running frontend proxy returned HTTP 200
for both revenue GET endpoints and `/api/workflows`. Revenue jobs remain disabled,
and the new integration migration has not been applied to the configured Supabase
database.

## Frontend

`/revenue` now uses the revenue endpoints with the existing authenticated
fetch wrapper and React Query. Active Company/Distributor/Partner Owners, Admins
and Managers see the sidebar entry, gross totals and searchable machine table.
Only Company Owners/Admins can edit deduction rates or view the fleet-wide live
Mothership payment feed. The feed includes all upstream statuses and is kept
separate from ledger totals; it is never imported by the page. It does not call
the older unimplemented reports/settlements endpoints or expose statement actions
without an API. Ledger values are INR; day/month boundaries come from the API's
IST calculation.

Queries are scoped by user, organization and role, with one minute of freshness
to preserve ledger results across navigation. The payment feed has a 30-second
freshness window. Refresh is explicit; window focus also refreshes stale data.
Permission loss hides the data and editor immediately.
Rate saves update the cache and invalidate other rate queries. Loading, empty,
error/retry, payment-feed access, direct fetching, validation and duplicate-submit
states are covered by:

```powershell
node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/revenue-ui-check.tsx
```

The mocked component checks, targeted revenue lint, API typecheck and frontend
typecheck pass. The payment-feed UI checks use mocked HTTP and do not send live
requests or modify rates/ledger data.

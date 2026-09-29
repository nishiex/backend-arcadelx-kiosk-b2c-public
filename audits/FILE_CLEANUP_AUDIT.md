# File cleanup audit

Checked 2026-09-29. This review deleted no additional files. The previously approved 75 generated test PDFs and 11 old logs have already been removed.

## What was checked

- Git changes and untracked files; package scripts, TypeScript aliases, Next routes, and configuration.
- Static imports, re-exports and literal dynamic imports across 131 TypeScript/TSX files in API source, frontend source, shared validation, and the shared UI source. The scan handles the backend's `import("./app.js")` resolving to `app.ts`.
- Audit report links, test/helper dependencies, saved assignment records, remaining artifacts, and empty directories.
- Dependency installations, generated Prisma internals and Next build internals were excluded from source analysis. This is a cleanup review, not a fresh runtime regression or proof that every function is used.

## Keep: application and development requirements

Paths are relative to the repository root.

| Files or directories | Why they are needed |
| --- | --- |
| `apps/api/src/` | Every scanned backend source file is reachable from the server entry point. Includes controllers, routes, middleware, services and utilities. |
| `apps/api/src/services/agreement-rules.ts` | Imported by agreement/order controllers; protects agreement and ownership operations. Untracked does not mean unwanted. |
| `apps/api/src/services/email/delivery.service.ts` | Imported by authentication/order controllers; implements durable email recovery. |
| `apps/api/prisma/schema.prisma`, `prisma.config.ts`, `prisma/seed.ts`, `prisma/migrations/` | Schema, setup tooling and migration history. Preserve the new `20260929100000_protect_distributor_lifecycle/migration.sql` too. |
| `packages/shared-types/validationSchemas/` | All scanned shared validators are reachable from the API. |
| `apps/web/next-monorepo/apps/web/app/` | Next route, layout and metadata entry points. Files do not need ordinary import references to be routes. |
| Current frontend components, hooks, providers and API helpers | Support the current UI; exceptions for review are explicitly listed below. |
| `apps/web/next-monorepo/apps/web/hooks/useOwnedKiosks.ts` | Used by `KiosksScreen.tsx` and `RecentKiosks.tsx`; preserves ownership filtering. |
| `InventoryBreakdown.tsx` | Used by the current dashboard. The Assigned-only change was undone; this file is still required. |
| `ThemeToggle.tsx` and other existing modified source | Preserve working changes; do not treat Git's modified status as a cleanup signal. |
| All package manifests, both `package-lock.json` files, TypeScript/ESLint/PostCSS/Next/Turbo configurations | The root and nested frontend are distinct install/build scopes. The lockfiles are not accidental duplicates. |
| `apps/web/next-monorepo/packages/ui/`, `packages/typescript-config/`, `packages/eslint-config/` | Shared workspace packages. Preserve package exports and configuration even when an individual component is not currently rendered. |
| `.env`, frontend `.env.local`, `.env.example`, `.gitignore`, `.nvmrc` | Environment, setup and repository configuration. Preserve local secrets; do not commit their contents. |
| Backend/frontend logos, favicon and styles | Application assets; lack of a TypeScript import alone does not establish that a public asset is unused. |
| `.git/` | Repository history and local working state. |

## Keep: tests, records and guidance

Under `audits/distributor-lifecycle/`:

| Files | Recommendation |
| --- | --- |
| `harness/` and all its phase files | Keep reproducible HTTP/database and migration tests. Some phases intentionally reproduce historical failures; they remain useful audit sources. |
| `test-model-assignment.ts` | Keep: imported by the rehearsal test and assignment helper. |
| `logout-browser-check.ts`, `verify-model-transfer.ts` | Keep verification scripts. They are not application runtime code. |
| `FIXES.md`, `REPORT.md`, `REGRESSION.md`, `HTTP_RESULTS.md`, `SUMMARY.json`, `*_FIX.md`, `REQUESTED_ASSIGNMENT.md` | Keep the explanation of fixes, historical findings, limitations and evidence. Historical reports are not current runtime specifications. |
| `running-model-transfer/before.json`, `result.json`, `verification.json`, `README.md` | Keep the record of actual test-data assignments. `apply-model-transfer.ts` checks `result.json` to prevent rerunning; `verify-model-transfer.ts` reads it. Removing it is not harmless artifact cleanup. |
| `running-model-transfer/*.png`, `logout-browser/`, `distributor-test-login/` | Retain evidence of transfer/logout/login checks. Login screenshots are historical and precede later inventory changes. |
| `latest-run.log`, `regression-run.log` | Keep the two execution logs linked from audit reports. |
| `regression-ui-check.json`, `regression-summary.mjs`, `summarize.mjs` | Keep report-generation inputs/helpers. The regression summarizer reads the UI-check JSON. |
| `migration-20260929075338524.json`, `preflight-20260929074928918.json` | Keep the final migration and configured-database preflight evidence linked from `FIXES.md`. |

Keep these run folders because reports link to their evidence or they document the actual verification sequence:

| Run folder | Purpose |
| --- | --- |
| `20260929071045080/` | Original complete audit and linked schema snapshot. |
| `20260929072537010/` | Fresh pre-fix regression. |
| `20260929075030579/` | Final complete F1–F11 fix regression. |
| `20260929091027876/` | Distributor-list compatibility check. |
| `20260929091925707/` | Assigned To organization-name verification. |
| `20260929093320592/` | Historical 130-machine transfer proof linked by `REQUESTED_ASSIGNMENT.md`. Its Company UI behavior was superseded. |
| `20260929093808077/` | Ownership-filtering and 130-machine transfer verification. |
| `20260929095936376/` | Rehearsal of the three-model assignment helper. |
| `20260929100841256/` | Logout HTTP/database regression. |

Keep `Agents.md`, `apps/api/AGENTS.md`, frontend `AGENTS.md` files, `CLAUDE.md`, and `FRONTEND_DESIGN.md` as development guidance. They are not runtime dependencies. The root setup guide contains older environment information; verify configuration when using it.

## Clear cleanup candidates

| Exact path or pattern | Reason |
| --- | --- |
| `audits/distributor-lifecycle/assigned-count/company.png` | Screenshot of the reverted Assigned-only Fleet composition change. |
| `audits/distributor-lifecycle/assigned-count/distributor.png` | Companion screenshot from that reverted change. |
| `audits/distributor-lifecycle/assigned-count/verification.json` | Verification record for the reverted UI behavior. |
| The 18 empty `audits/distributor-lifecycle/<run>/invoices/` directories | No files remain after PDF cleanup. They contain no current evidence; future runs create their own output folders. |

No additional deletion was performed during this review. `REPORT.md` still mentions generated invoice output as a historical artifact; those PDFs were already removed at the user's request.

## Archive candidates: retain elsewhere before removing from this workspace

These are historical/debug outputs, not runtime dependencies. Their lack of links from the main reports does not make their evidence valueless.

- Earlier intermediate run folders: `20260929070359995/`, `20260929070411217/`, `20260929070442875/`, `20260929070639530/`, `20260929070833640/`, `20260929073813775/`, `20260929074043301/`, `20260929074451454/`, `20260929090011640/`.
- Earlier migration outputs: `migration-20260929074853477.json`, `migration-20260929075008439.json`. Preserve the final migration evidence listed above.
- One-time diagnostics/setup helpers: `assignment-preflight.ts`, `distributor-list-diagnostic.ts`, `kiosk-assignment-diagnostic.ts`, `preview-model-transfer.ts`, `apply-model-transfer.ts`, `create-distributor-test-login.ts`; associated `model-transfer-preview.json` and `requested-assignment-preflight.json`. Keep them if the setup needs to be investigated or reproduced. Do not run mutation helpers as cleanup commands.
- Schema snapshot files have equal sizes in many runs, but their SHA-256 hashes differ: they are **not verified byte-for-byte duplicates**. Do not delete them as duplicates.

## Source files to review before deleting

The following **31 frontend files** have no import path from the current Next route/config entry points in the static scan. They are candidates for a separate code cleanup, not confirmed disposable files. Some are reusable components or older dashboard features that may be intended for future use. Static analysis does not establish product intent.

All paths below are relative to `apps/web/next-monorepo/apps/web/`:

| Directory | Files |
| --- | --- |
| `components/dashboard/` | `CustomizeDashboard.tsx`, `DashboardGrid.tsx`, `DashboardHeader.tsx`, `DashboardKPIs.tsx`, `DashboardProvider.tsx`, `DashboardShell.tsx`, `OrdersAnalytics.tsx`, `OverviewChart.tsx`, `RecentActivity.tsx`, `RecentOrders.tsx`, `RevenueAnalytics.tsx`, `StatsCards.tsx` |
| `components/dashboard/widgets/` | `ActivityWidget.tsx`, `CustomersWidget.tsx`, `InventoryChartWidget.tsx`, `OrdersWidget.tsx`, `PendingMembersWidget.tsx`, `RevenueWidget.tsx`, `SystemHealthWidget.tsx` |
| `components/reactbits/` | `AnimatedNumber.tsx`, `BlurText.tsx`, `CountUp.tsx`, `ShinyButton.tsx`, `SpotlightCard.tsx` |
| `components/ui/` | `button.tsx`, `card.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `tooltip.tsx` |
| `lib/` | `dashboard-data.ts`, `mock-data.ts` |

The separate `apps/web/next-monorepo/packages/ui/src/components/button.tsx` also has no current route reachability, but belongs to the shared UI package: retain it as a library component unless intentionally changing that package's surface.

The current dashboard uses `DashboardScreen.tsx` → `StatGrid.tsx`, `InventoryBreakdown.tsx`, `RecentKiosks.tsx`. Its route layout uses `Sidebar.tsx`, `Header.tsx`, and `AuthGuard.tsx`. Preserve these. The used `components/dashboard/CountUp.tsx` is distinct from the unreferenced `components/reactbits/CountUp.tsx`.

Before source removal, check any intended feature reuse and then run frontend typecheck, lint, build and relevant UI checks. No source files were removed and no runtime tests were rerun for this documentation-only review.

## Generated or optional tooling files

- `node_modules/`: installed dependencies, rebuildable through installation, needed to run the current app. Not a routine cleanup target here.
- `.next/`, `.turbo/`, `*.tsbuildinfo`: generated build caches; can be regenerated. Avoid clearing caches under a running development process just to tidy files.
- `apps/api/src/generated/prisma/`: generated but imported by the backend. Regenerate with Prisma; do not manually prune it.
- `next-env.d.ts`: generated Next types used by TypeScript; preserve during development.
- `.claude/launch.json`: optional editor launch configuration, not an application dependency. Keep if that launcher is used.
- `apps/web/next-monorepo/public/Text.svg` and `dark.svg`: no references were found in the searched source/config/docs. They sit outside the Next app's own `public/` directory. Review design/tooling use before treating them as disposable assets.

Recommendation: clean only the three reverted-feature artifacts and empty invoice directories first. Preserve runtime files, migrations, reusable regression tests and actual assignment records. Archive historical runs and review unused frontend components separately.

# File cleanup audit

## JSON cleanup: 2026-09-29, 18:58 IST

Reviewed 57 project JSON files, excluding installed dependencies and generated
build/client internals. Removed **6 untracked JSON files (165,985 bytes)** after
archiving and verifying every file's SHA-256:

| Removed path (relative to `audits/`) | Reason |
| --- | --- |
| `FILE_CLEANUP_MANIFEST.json` | Relocated beside the recovery archives; historical recovery metadata. |
| `distributor-lifecycle/SUMMARY.json` | Generated summary; original evidence and report generator retained. |
| `distributor-lifecycle/20260929072537010/regression-summary.json` | Generated summary; evidence, report and generator retained. |
| `distributor-lifecycle/20260929090011640/evidence.json` | Superseded isolated assignment run; later complete run `20260929091925707` retained. |
| `distributor-lifecycle/20260929090011640/assignment-result.json` | Summary of the same superseded run; Markdown report retained. |
| `distributor-lifecycle/20260929091925707/assignment-result.json` | Duplicates `assignment-test-result` in the retained evidence file. |

Source/reference checks found only generator writes for the removed summaries,
not application or helper reads. All 21 package/build/editor JSON files remain,
as do 30 audit JSON files needed by scripts, linked reports, deployment records,
or latest verification. In particular, transfer preview/preflight inputs and
the completed transfer record that prevents accidental reruns remain.

Recovery archive: `C:\Users\Abcom\Desktop\arcadelx-cleanup-backups\json-cleanup-20260929-185810.zip`.
Its adjacent `.json` manifest records exact paths, reasons and hashes. The earlier
cleanup manifest is also available as
`C:\Users\Abcom\Desktop\arcadelx-cleanup-backups\FILE_CLEANUP_MANIFEST-20260929-175737.json`.
Verified all 364 remaining tracked/untracked working files and the Git index
were unchanged before updating this note. No application code or database changed.
This JSON review supersedes the historical recommendation below to retain the
generated `SUMMARY.json` in the workspace.

## Follow-up cleanup: 2026-09-29, 18:54 IST

Removed another **36 untracked files (2,581,478 bytes)** and **13 empty
directories** after the invite-code and invoice changes:

- Archived four superseded intermediate invite-code runs:
  `20260929124414428`, `20260929124520027`, `20260929125441451`,
  `20260929125522313` (17 files, including generated test PDFs).
- Removed 19 generated test PDFs from the retained successful regression runs.
- Removed the resulting empty directories and the empty root `tmp/pdfs` tree.

Recovery archive: `C:\Users\Abcom\Desktop\arcadelx-cleanup-backups\cleanup-20260929-185425.zip`.
The adjacent `cleanup-20260929-185425.json` records every removed path and SHA-256.
All archive entries were verified before deletion. Hash verification confirmed
that all 370 remaining tracked/untracked working files and the Git index were
unchanged before this audit note was added.

Preserved the successful full invite regression (`20260929124550708`), latest
invite/generation compatibility results (`20260929125602088`), latest invoice
regression (`20260929130844532`), their schema snapshots, and
`output/pdf/invoice-design-preview.pdf`. Application source, current changes,
configuration, migrations, test harnesses and historical linked evidence remain.
No application code or database was changed.

## Earlier cleanup

Cleanup completed 2026-09-29 after the user requested removing unwanted files.

Removed **38 files (2,117,936 bytes)** and **33 empty directories** from the project:

| Removed category | Files |
| --- | ---: |
| Superseded intermediate audit results/schema snapshots | 18 |
| Newly generated isolated-test invoice PDFs | 15 |
| Screenshots/verification for the reverted Assigned-only Fleet display | 3 |
| Superseded migration diagnostics | 2 |

Every removed file was untracked, inside `audits/distributor-lifecycle`, and
archived first. Each archived file's SHA-256 was verified against its source
before removal. Exact paths and hashes are in [the relocated cleanup manifest](../../arcadelx-cleanup-backups/FILE_CLEANUP_MANIFEST-20260929-175737.json).
Recovery archive: `C:\Users\Abcom\Desktop\arcadelx-cleanup-backups\cleanup-20260929-175737.zip`.

**Preserved:** all application source, shared packages, environment/configuration,
lockfiles, migrations, current changes, test scripts, original complete audit,
linked historical evidence, real assignment/deployment records, latest Orders
verification (`20260929114444300`), full regression (`20260929121006343`) and
retention/reactivation results (`20260929121828960`). The earlier status verification
(`20260929120912488`) is also retained. No database was changed.

Frontend files listed as unreferenced below remain review candidates, not proven
disposable source. Running dependency/build caches were retained. Root Turbo cache
output is now gitignored. The API/database health and frontend were checked after
cleanup; source tests were not rerun because no application code changed.

## Prior read-only review (historical)

The review below preceded this cleanup. Its removal candidates and no-deletion
statements describe that earlier review. The previously approved 75 generated test
PDFs and 11 old logs had already been removed at that time.

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

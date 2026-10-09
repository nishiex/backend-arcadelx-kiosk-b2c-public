# Dead-code audit — 2026-10-06

Scope: Frontend-Backend-Merge at 802d932 plus the current uncommitted workspace, including revenue and member invitation integration. Application source was not edited or deleted.

## Findings

- Scanned 143 source/config/script files. 131 are reachable from the API server or Next app/config entries.
- 0 source files (0 line slots, including blank lines) have no current application entry path: 32 web application candidates, one test-only RequestsScreen, and one exported shared-library button.
- All API source modules and shared validation modules are reachable. Module reachability does not prove every export or branch within them is used.
- The API revenue worker is conditionally imported by server.ts when REVENUE_JOBS_ENABLED=true. It is not dead code merely because jobs default to disabled.

## Confirmed unused symbols

| Location | Symbol | Evidence |
| --- | --- | --- |
| apps/api/src/utils/token.ts:1 | SignOptions import | TypeScript TS6133 |
| apps/web/next-monorepo/apps/web/app/layout.tsx:1 | Geist_Mono import | TypeScript TS6133 |
| apps/web/next-monorepo/apps/web/components/dashboard/Header.tsx:6 | Share2 import | TypeScript TS6133 |
| apps/web/next-monorepo/apps/web/components/dashboard/Header.tsx:10 | fetchNetworkRequests import | TypeScript TS6133; the function itself is still used by StatGrid |
| packages/shared-types/validationSchemas/Kiosk/kiosk.validation.ts:13 | ManualOverrideExternalIdSchema export | Repository code search found only its definition |
| apps/web/next-monorepo/apps/web/lib/backend-api.ts:494 | registerKiosk wrapper | Repository code search found only its definition; AddMachineDialog uses createKioskBatch |

Unused locals inside orphan dashboard/reactbits files are also reported by TypeScript. They can be addressed with their containing files.

## Files with no application entry path

Paths relative to repository root. Internal imports within an unreachable component group do not make that group used by the app.

| File | Lines | Direct importers in scan |
| --- | ---: | --- |


RequestsScreen is still imported by scripts/decision-ui-check.tsx. The /requests page is absent. Treat it as a disconnected feature to restore or intentionally retire, not a disposable untested component. Its shared fetchReviewRequests helper remains used by the active order request flow.

The shared UI button is a package export and is imported by the orphan ShinyButton component. It is unused by this app, but package API intent must be considered separately.

The active dashboard uses DashboardScreen, DashboardWelcome, StatGrid, InventoryBreakdown and RecentKiosks. Its dashboard/CountUp is distinct from the orphan reactbits/CountUp. Keep the active components.

## Dependency removal candidates

Repository source/config searches found these only in package manifests (lockfiles excluded):

- API devDependencies: nodemon, ts-node-dev, pino-pretty. Development uses tsx watch.
- Web dependencies: @phosphor-icons/react, @radix-ui/react-separator, @radix-ui/react-tabs, @tanstack/react-table, next-themes.
- Shared UI dependencies: @phosphor-icons/react, next-themes.

These are candidates, not installation-verified removals. The app has its own theme provider. Keep react-hook-form: active auth, registration and settings screens use it. Keep shadcn and tw-animate-css: global CSS imports them. Keep package/config exports and both install-scope lockfiles.

## Reachable but incomplete features are not dead code

Support, reports, settlements, payments, roles and audit pages remain Next route entry points. The current API does not mount corresponding general-purpose support/reports/settlements/payments/roles/audit modules. Missing API support is a product integration issue, not proof those reachable screens can be deleted. Backend routes also serve API clients independently of this frontend.

## Verification and limitations

Ran the static AST import graph and TypeScript with --noEmit --noUnusedLocals --noUnusedParameters for API and web. Web used --incremental false. Both commands exited 1 due to unused diagnostics; web additionally reports the existing KioskStatus/RESERVED mismatch in components/dashboard/ui.tsx:130. No runtime, browser or database mutation tests were run.

API diagnostics other than SignOptions were unused Express callback parameters. Preserve error middleware's four-argument signature: deleting next because it is unread changes how Express classifies the handler.

The graph recognizes static imports/re-exports, literal import()/require(), .js-to-.ts references, @/, @shared-types/ and @workspace/ui/ aliases. Framework app files are explicit roots. It does not prove arbitrary computed imports, external consumers, CSS usage or individual exported-symbol reachability. One unresolved specifier is @workspace/ui/postcss.config; its package export was manually verified and is required configuration. Generated Prisma/Next code, dependencies, binary assets, migration history and audit evidence are not deletion candidates in this audit.

Reproduce: node audits/dead-code/scan.cjs. Raw graph evidence: scan.json. Review the 32 application candidates first; handle RequestsScreen and the shared package export separately. No cleanup has been applied.

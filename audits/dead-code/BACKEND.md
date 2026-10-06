# Backend dead-code review — 2026-10-06

Scope: current Frontend-Backend-Merge working tree, including uncommitted API revenue/member invitations and shared validation. No application files were changed.

## Confirmed unused code

| File | Line | Finding |
| --- | ---: | --- |
| apps/api/src/utils/token.ts | 1 | Unused SignOptions type import; confirmed by TypeScript TS6133. |
| packages/shared-types/validationSchemas/auth.validation.ts | 79 | RegisterOrgInput exported type has no repository code references. Removing it does not remove RegisterOrgSchema. |
| packages/shared-types/validationSchemas/Kiosk/kiosk.validation.ts | 13 | ManualOverrideExternalIdSchema has no repository code references. PairDeviceSchema is used and must remain. |

## Unnecessary public exports, not dead implementations

OrganizationAccess (services/organization-access.ts:6), ReportConfig (services/pdf/revenue.pdf.ts:24), and RoleEnum (shared member.validation.ts:3) are used within their own files but have no external code references found. Their export modifiers could be removed if these are not intended shared interfaces. Keep their definitions and internal uses. ReportConfig describes an exported function parameter, so retaining its export is also reasonable API design.

## Dependency candidates

apps/api/package.json devDependencies nodemon, ts-node-dev and pino-pretty occur only in package manifests in the searched repository code/configuration. Package dev/start scripts use tsx. They are candidates for removal from the manifest and lockfile in a later cleanup; no install/prune was performed. Manual developer CLI usage cannot be ruled out by repository search.

## Keep

- All API source modules are reachable from server.ts, including its literal dynamic imports. All controller exports have references in the analyzed program; route modules are mounted.
- startRevenueJobs is dynamically destructured and called in server.ts:11-12 when REVENUE_JOBS_ENABLED=true. The symbol scanner alone misses that reference; manual verification overrides its raw candidate.
- previousRevenueMonth and revenueJobPeriod are used by revenue.worker.ts and directly imported by audits/distributor-lifecycle/harness/phases/revenue.ts. Their exports support tests.
- Revenue queue, Redis configuration, statement/import services, delivery retry code, internal pairing and shared validation remain connected.
- Ten unused Express callback parameters were reported by TypeScript. These are signature placeholders, not dead handlers. Preserve positional arguments and errorHandler's four-argument signature. Rename unused parameters with underscores if desired; do not simply delete them.
- Prisma generated code, migrations, seed/configuration entry points and audit helpers are not runtime-orphan deletion candidates.

## Verification

Semantic export scan inspected 54 non-generated/non-declaration TypeScript program files and 132 named exports. Cross-checked no-reference and same-file-only findings against repository source and audit scripts. Previous AST module graph confirms server/route reachability.

Ran: node node_modules/typescript/bin/tsc --noEmit --noUnusedLocals --noUnusedParameters --allowUnreachableCode false -p apps/api/tsconfig.json

Result: exit 1, with eleven TS6133 diagnostics (one unused import and ten callback parameters). No other errors or unreachable-statement diagnostics were reported. This does not prove every business branch can execute: compiler checks cannot establish all domain invariants or external API usage.

Raw semantic evidence: backend-symbols.json. Reproduce with node audits/dead-code/backend-symbols.cjs. Scanner results require the dynamic-import and audit-consumer checks described above. No database or runtime mutation tests were run.

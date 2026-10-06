// Static module reachability audit. Does not execute application code.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const web = 'apps/web/next-monorepo/apps/web';
const norm = p => p.replaceAll('\\', '/');
const rel = p => norm(path.relative(root, p));
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'generated', '.turbo'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(p) && !p.endsWith('.d.ts')) files.push(p);
  }
}
for (const p of ['apps/api/src', 'packages/shared-types', web, 'apps/web/next-monorepo/packages/ui/src']) walk(path.join(root, p));
const fileSet = new Set(files.map(norm));
const graph = new Map();
const unresolved = [];
const imports = [];
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specs = [];
  function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText(source) === 'require') && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) specs.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  }
  visit(source);
  const edges = [];
  for (const s of specs) {
    imports.push({ file: rel(file), specifier: s });
    let base;
    if (s.startsWith('.')) base = path.resolve(path.dirname(file), s);
    else if (s.startsWith('@/')) base = path.join(root, web, s.slice(2));
    else if (s.startsWith('@shared-types/')) base = path.join(root, 'packages/shared-types', s.slice(14));
    else if (s.startsWith('@workspace/ui/')) base = path.join(root, 'apps/web/next-monorepo/packages/ui/src', s.slice(14));
    else continue;
    const stripped = base.replace(/\.[cm]?jsx?$/, '');
    const candidates = [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.tsx'].map(ext => stripped + ext)];
    const resolved = candidates.map(norm).find(p => fileSet.has(p));
    if (resolved) edges.push(resolved);
    else if (!/generated|\.css$/.test(base)) unresolved.push({ file: rel(file), specifier: s });
  }
  graph.set(norm(file), edges);
}
const roots = files.filter(f => {
  const p = rel(f);
  return p === 'apps/api/src/server.ts' || p.startsWith(web + '/app/') || p === web + '/next.config.ts';
});
const reached = new Set();
function mark(f) { if (reached.has(f)) return; reached.add(f); for (const d of graph.get(f) || []) mark(d); }
roots.forEach(f => mark(norm(f)));
const candidates = files.filter(f => !reached.has(norm(f)) && !rel(f).includes('/scripts/') && !/config\.[cm]?[jt]s$/.test(f)).map(f => ({
  file: rel(f), lines: fs.readFileSync(f, 'utf8').split('\n').length,
  importedBy: [...graph].filter(([, edges]) => edges.includes(norm(f))).map(([p]) => rel(p)),
}));
const result = { branch: 'Frontend-Backend-Merge working tree', scannedFiles: files.length, reachableFiles: reached.size, candidates, unresolved, imports };
fs.writeFileSync(path.join(__dirname, 'scan.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ scannedFiles: files.length, reachableFiles: reached.size, candidates, unresolved }, null, 2));
const totalLines = candidates.reduce((sum, f) => sum + f.lines, 0);
const report = `# Dead-code audit — 2026-10-06

Scope: Frontend-Backend-Merge at 802d932 plus the current uncommitted workspace, including revenue and member invitation integration. Application source was not edited or deleted.

## Findings

- Scanned ${files.length} source/config/script files. ${reached.size} are reachable from the API server or Next app/config entries.
- ${candidates.length} source files (${totalLines} line slots, including blank lines) have no current application entry path: 32 web application candidates, one test-only RequestsScreen, and one exported shared-library button.
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
${candidates.map(f => '| ' + f.file + ' | ' + f.lines + ' | ' + (f.importedBy.join(', ') || 'None') + ' |').join('\n')}

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
`;
fs.writeFileSync(path.join(__dirname, 'REPORT.md'), report);

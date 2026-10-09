// Bundle the Vercel function entry into a self-contained file.
//
// Why this exists: the API imports runtime Zod values from `@shared-types/*`, which resolve
// only through the tsconfig `paths` alias into ../../packages/shared-types. Vercel's function
// bundler does not apply tsconfig path aliases, and it only uploads the project root, so that
// sibling folder is not present either. esbuild does honour the alias, so bundling here makes
// the alias disappear as a runtime concern.
//
// Only first-party code is inlined. npm dependencies (and the generated Prisma client, which
// ships type-only `.ts` sources that cannot run directly) stay external and are installed by
// npm on the platform. The output goes to a separate directory so the authored entry is never
// overwritten.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const entry = path.join(apiRoot, 'serverless', 'entry.ts');
// Vercel requires Functions to live in a top-level `api` directory. The API project deploys
// from the REPO ROOT rather than apps/api, because `packages/shared-types` is resolved by
// tsconfig path alias and only exists inside the uploaded tree when the root is the repo.
const outDir = path.join(repoRoot, 'api');
const outfile = path.join(outDir, 'index.mjs');

// First-party prefixes to inline, as absolute directory prefixes.
const inline = [
  path.join(apiRoot, 'serverless') + path.sep,
  path.join(apiRoot, 'src') + path.sep,
  path.join(repoRoot, 'packages', 'shared-types') + path.sep,
].map(prefix => prefix.replace(/\\/g, '/'));

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: path.join(apiRoot, 'tsconfig.json'),
  outfile,
  logLevel: 'warning',
  metafile: true,
  plugins: [
    {
      // Inline first-party files; leave everything else to npm at runtime.
      name: 'first-party-only',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /.*/ }, args => {
          if (args.kind === 'entry-point') return undefined;
          // @shared-types and relative paths are left to esbuild: it applies the tsconfig
          // `paths` alias (the reason this bundling step exists) and resolves extensions.
          if (args.path.startsWith('@shared-types/') || args.path.startsWith('.')) {
            return undefined;
          }
          // Every other bare specifier is an npm package: install it at runtime instead.
          return { external: true };
        });
      },
    },
  ],
});

const { size } = await fs.stat(outfile);
const inputs = Object.keys(result.metafile.inputs);
const aliasInlined = inputs.filter(name => name.replace(/\\/g, '/').includes('shared-types'));

if (aliasInlined.length === 0) {
  throw new Error('Bundle did not inline @shared-types - the alias would fail on Vercel.');
}

const bundled = await fs.readFile(outfile, 'utf8');
if (/from\s*["']@shared-types\//.test(bundled) || /from\s*["']\.\.\/src\//.test(bundled)) {
  throw new Error('Bundle still contains an unresolved alias or relative src import.');
}
if (/from\s*["'][^"']*src\/generated/.test(bundled)) {
  throw new Error('Generated Prisma client was inlined; it must stay external.');
}

await fs.mkdir(outDir, { recursive: true });
// A non-framework project must expose an output directory or Vercel fails the build. It is
// kept EMPTY on purpose: any file here (an index.html, say) is served in preference to the
// Function and would shadow every API route. A zero-byte file keeps the directory present in
// the deployment without ever competing with the Function.
await fs.rm(path.join(outDir, 'public'), { recursive: true, force: true });
await fs.mkdir(path.join(outDir, 'public'), { recursive: true });
await fs.writeFile(
  path.join(outDir, 'public', `.keep-${crypto.randomUUID()}`),
  '',
  'utf8',
);

// Ship the runtime assets next to the bundle. asset-file.ts probes several locations, and
// this one is checkable from the bundle's own directory, so it holds on the platform where
// __dirname-style relative paths do not.
const assetsSource = path.join(apiRoot, 'src', 'assets');
const assetsTarget = path.join(outDir, 'assets');
await fs.rm(assetsTarget, { recursive: true, force: true });
await fs.cp(assetsSource, assetsTarget, {
  recursive: true,
  // The *-original.png files are full-resolution masters kept for print; they must not ship.
  filter: source => !source.endsWith('-original.png'),
});
const shipped = await fs.readdir(assetsTarget);
console.log(`[build-vercel] assets shipped: ${shipped.join(', ')}`);

console.log(
  `[build-vercel] bundled: ${size.toLocaleString()} bytes, ${inputs.length} first-party modules, ` +
  `${aliasInlined.length} shared-types file(s) inlined -> api/index.mjs`,
);

// Resolve a file under src/assets in every layout this code runs in.
//
// Why this is not a one-liner: `new URL('../../assets/', import.meta.url)` is correct when the
// source runs from apps/api/src/services/**, but the deployed function is a single BUNDLE at
// <root>/api/index.mjs, so the same relative expression resolves to <root>/../assets -- outside
// the function root -- and fs.readFileSync throws ENOENT. That silently broke credential
// emails on Vercel: attemptDelivery() catches the throw, leaves sentAt null and increments the
// attempt count, so the UI only ever showed "not emailed yet".
//
// The candidates below cover, in order:
//   1. import.meta.url-relative  - local development, and tsx-run scripts
//   2. process.cwd()/src/assets  - the API started with apps/api as the working directory
//   3. process.cwd()/apps/api/... - the repo root as the working directory (Vercel)
//   4. __dirname-relative        - bundled output that kept a __dirname shim
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every directory that may hold the assets, most specific first. */
function candidates(): string[] {
  const moduleRelative = path.resolve(here, '..', 'assets');
  const cwd = process.cwd();
  return [
    moduleRelative,
    // Bundled deployment: the build copies assets beside the bundle, so this hits when the
    // module directory IS the function directory.
    path.join(here, 'assets'),
    // Vercel sets VERCEL=1 and may run from /var/task, so cover the root relative to cwd and
    // the well-known task root explicitly rather than relying on cwd alone.
    path.join(cwd, 'api', 'assets'),
    '/var/task/api/assets',
    '/var/task/assets',
    path.join(cwd, 'src', 'assets'),
    path.join(cwd, 'apps', 'api', 'src', 'assets'),
    path.resolve(here, '..', '..', 'apps', 'api', 'src', 'assets'),
    path.resolve(here, '..', '..', '..', 'apps', 'api', 'src', 'assets'),
  ];
}

/**
 * Absolute path to one asset file. Throws with every location tried, so a deployment
 * misconfiguration is diagnosable rather than a bare ENOENT.
 */
export function assetFile(name: string): string {
  const tried = candidates().map(base => path.join(base, name));
  const found = tried.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Asset "${name}" not found. Looked in:\n  ${tried.join('\n  ')}`);
  }
  return found;
}

/** Directory holding the assets, used where pdfkit needs a path root. */
export function assetDir(): string {
  return path.dirname(assetFile('arcadelx-logo.png'));
}

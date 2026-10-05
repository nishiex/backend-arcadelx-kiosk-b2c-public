// In-process TypeScript loader for isolated tests; no esbuild child process.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { registerHooks } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
registerHooks({
  resolve(specifier, context, nextResolve) {
    let base;
    if (specifier.startsWith('@shared-types/')) base = path.join(root, 'packages/shared-types', specifier.slice('@shared-types/'.length));
    if (specifier.startsWith('@/')) base = path.join(root, 'apps/web/next-monorepo/apps/web', specifier.slice(2));
    if (!base) {
      try { return nextResolve(specifier, context); }
      catch (error) {
        if (!specifier.startsWith('.')) {
          try { return nextResolve(specifier + '.js', context); } catch { throw error; }
        }
        if (!context.parentURL?.startsWith('file:')) throw error;
        base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      }
    }
    const candidates = [base, base + '.ts', base + '.tsx', base + '.js', path.join(base, 'index.ts')];
    if (base.endsWith('.js')) candidates.push(base.slice(0, -3) + '.ts');
    const found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
      const file = fileURLToPath(url);
      const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

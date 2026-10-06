const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const configFile = path.join(root, 'apps/api/tsconfig.json');
const config = ts.readConfigFile(configFile, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter(f => !f.isDeclarationFile && !/node_modules|[/\\]generated[/\\]/.test(f.fileName));
const exportEntries = [];
for (const source of sources) {
  const module = checker.getSymbolAtLocation(source);
  if (!module) continue;
  for (const symbol of checker.getExportsOfModule(module)) {
    if (symbol.name === 'default') continue;
    const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
    if (!declaration || declaration.getSourceFile() !== source) continue;
    exportEntries.push({ symbol, declaration, source, name: symbol.name, refs: [] });
  }
}
const bySymbol = new Map(exportEntries.map(e => [e.symbol, e]));
for (const source of sources) {
  function visit(node) {
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const entry = bySymbol.get(symbol);
      if (entry && node !== entry.declaration.name) {
        entry.refs.push({ file: path.relative(root, source.fileName).replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const result = exportEntries.map(e => ({ name: e.name, file: path.relative(root, e.source.fileName).replaceAll('\\', '/'), line: e.source.getLineAndCharacterOfPosition(e.declaration.getStart()).line + 1, references: e.refs }));
fs.writeFileSync(path.join(__dirname, 'backend-symbols.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ files: sources.length, exportEntries: result.length, noReferences: result.filter(e => !e.references.length), onlySameFile: result.filter(e => e.references.length && e.references.every(r => r.file === e.file)) }, null, 2));


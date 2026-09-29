import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const run = process.argv[2] || fs.readdirSync(dir).filter(x=>/^\d+$/.test(x)).sort().at(-1);
const rows = JSON.parse(fs.readFileSync(path.join(dir,run,'evidence.json'),'utf8'));
const summary = rows.find(x=>x.id==='run-summary');
const requests = rows.filter(x=>x.kind==='HTTP');
const esc = x => String(x ?? '').replaceAll('|','\\|').replaceAll('\n',' ');
let markdown = `# HTTP audit results\n\nRun: ${run}. ${requests.length} requests. Full bodies, responses, database snapshots, barriers and checks are in [evidence.json](${run}/evidence.json).\n\nExpected statuses include requested policy assumptions; MISMATCH is not a count of unique bugs. Unspecified expectations are observations or paired race tests. Tests run against the isolated audit API, not the original application database.\n\n| Evidence ID | Actor | Request | HTTP | Expected | Result |\n| --- | --- | --- | --- | --- | --- |\n`;
for (const x of requests) markdown += `| ${esc(x.id)} | ${esc(x.actor)} | ${esc(x.method+' '+x.route)} | ${x.status} | ${esc(Array.isArray(x.expected)?x.expected.join('/'):x.expected)} | ${x.pass===undefined?'OBSERVED':x.pass?'PASS':'MISMATCH'} |\n`;
fs.writeFileSync(path.join(dir,'HTTP_RESULTS.md'),markdown);
const meta = {
  run,
  ...summary,
  databaseProbes:rows.filter(x=>x.kind==='database constraint probe; transaction rolled back').length,
  raceBarriers:rows.filter(x=>x.kind==='concurrency barrier').map(x=>({id:x.id,synchronized:x.synchronized})),
  fatalErrors:rows.filter(x=>x.id==='harness-error'),
  sourceUnchanged:rows.find(x=>x.id==='application-sources-unchanged')?.pass,
  existingLocalDatabaseUnchanged:rows.find(x=>x.id==='existing-database-unchanged')?.pass,
};
fs.writeFileSync(path.join(dir,'SUMMARY.json'),JSON.stringify(meta,null,2));
console.log(JSON.stringify(meta,null,2));

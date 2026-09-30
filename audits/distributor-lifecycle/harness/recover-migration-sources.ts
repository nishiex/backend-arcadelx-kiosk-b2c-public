// Recover historical SQL only when its SHA256 matches the DB migration record.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const target = JSON.parse(fs.readFileSync(path.join(root, 'audits/distributor-lifecycle/schema-reconciliation.json'), 'utf8')).extraMigrations;
const repositories = [root, path.resolve(root, '../worked/backend-arcadelx-kiosk-b2c')];
const candidates = new Map<string, Buffer>();
for (const repo of repositories) {
  if (!fs.existsSync(path.join(repo, '.git'))) continue;
  const tracked = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(line => /migration\.sql$/.test(line)).map(line => line.split(' ')[0]!);
  const unreachable = execFileSync('git', ['fsck', '--full', '--no-reflogs', '--unreachable'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(line => line.startsWith('unreachable blob ')).map(line => line.split(' ')[2]!);
  for (const oid of new Set([...tracked, ...unreachable])) {
    const content = execFileSync('git', ['cat-file', 'blob', oid], { cwd: repo });
    for (const buffer of [content, Buffer.from(content.toString('utf8').replaceAll('\r\n', '\n')), Buffer.from(content.toString('utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'))]) {
      candidates.set(crypto.createHash('sha256').update(buffer).digest('hex'), buffer);
    }
  }
}
const result = target.map((item: any) => {
  const buffer = candidates.get(item.checksum);
  if (buffer) {
    const folder = path.join(root, 'apps/api/prisma/migrations', item.migration_name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'migration.sql'), buffer, { flag: 'wx' });
  }
  return { name: item.migration_name, recovered: !!buffer, expectedChecksum: item.checksum };
});
fs.writeFileSync(path.join(root, 'audits/distributor-lifecycle/migration-source-recovery.json'), JSON.stringify({ candidates: candidates.size, result }, null, 2));
console.log(JSON.stringify(result, null, 2));

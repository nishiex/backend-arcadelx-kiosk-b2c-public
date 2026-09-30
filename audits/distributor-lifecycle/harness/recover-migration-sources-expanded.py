"""Recover only exact database-checksummed SQL from local Git, ZIPs and editor history."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

root = Path.cwd()
home = Path('C:/Users/Abcom')
targets = json.loads((root / 'audits/distributor-lifecycle/schema-reconciliation.json').read_text())['extraMigrations']
wanted = {item['checksum']: item['migration_name'] for item in targets}
candidates = set()
matches = {}
sources = []
errors = []

def check(data, source):
    for value in (data, data.replace(b'\r\n', b'\n'), data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')):
        digest = hashlib.sha256(value).hexdigest()
        candidates.add(digest)
        if digest in wanted:
            matches[digest] = (source, value)

repositories = [root, home / 'Desktop/worked/backend-arcadelx-kiosk-b2c', home / 'Arcadelx/backend-arcadelx-kiosk-b2c']
for repo in repositories:
    try:
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL)
        tracked = git('rev-list', '--objects', '--all', '--reflog').decode().splitlines()
        oids = {line.split()[0] for line in tracked if line.endswith('migration.sql')}
        dangling = git('fsck', '--full', '--no-reflogs', '--unreachable').decode().splitlines()
        oids.update(line.split()[2] for line in dangling if line.startswith('unreachable blob '))
        for oid in oids:
            check(git('cat-file', 'blob', oid), f'{repo}:git:{oid}')
        sources.append({'git': str(repo), 'blobs': len(oids)})
    except subprocess.CalledProcessError:
        errors.append({'git': str(repo), 'error': 'Git scan failed'})

skip = {'node_modules', '.git', '.next', 'Cache', 'Code Cache', 'GPUCache', 'Windows', '.vscode', '.vscode-shared'}
disk_count = 0
archives = []
for directory, directories, files in os.walk(home, onerror=lambda e: None):
    directories[:] = [name for name in directories if name not in skip]
    for name in files:
        file = Path(directory) / name
        # SQL editor history files use arbitrary names, but retain their SQL extension.
        if name == 'migration.sql' or (name.endswith('.sql') and '/User/History/' in file.as_posix()):
            try:
                check(file.read_bytes(), str(file)); disk_count += 1
            except OSError:
                errors.append({'file': str(file), 'error': 'Unreadable'})
        if name.endswith('.zip') and ('arcadelx' in str(file).lower() or file.parent == home / 'Downloads'):
            archives.append(file)
sources.append({'diskSQLFiles': disk_count})
for archive in archives:
    try:
        with zipfile.ZipFile(archive) as z:
            entries = [info for info in z.infolist() if info.filename.endswith('.sql')]
            for entry in entries:
                check(z.read(entry), f'{archive}:{entry.filename}')
            sources.append({'archive': str(archive), 'sqlEntries': len(entries)})
    except (OSError, zipfile.BadZipFile):
        errors.append({'archive': str(archive), 'error': 'Archive unreadable'})

result = []
for digest, name in wanted.items():
    match = matches.get(digest)
    row = {'name': name, 'expectedChecksum': digest, 'recovered': bool(match)}
    if match:
        source, data = match
        dest = root / 'apps/api/prisma/migrations' / name / 'migration.sql'
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            assert dest.read_bytes() == data, 'Refuse to overwrite different SQL'
        else:
            dest.write_bytes(data)
        row['source'] = source
    result.append(row)
evidence = {'candidateHashes': len(candidates), 'sources': sources, 'errors': errors, 'result': result}
(root / 'audits/distributor-lifecycle/migration-source-recovery-expanded.json').write_text(json.dumps(evidence, indent=2))
print(json.dumps({'candidateHashes': len(candidates), 'result': result, 'errors': errors}, indent=2))

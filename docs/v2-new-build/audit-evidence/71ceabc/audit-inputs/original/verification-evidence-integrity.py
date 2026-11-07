import collections
import hashlib
import json
import pathlib
import subprocess
import zipfile

base = pathlib.Path(__file__).resolve().parent
repo = base / 'wevid-complete'
coverage = json.loads((base / 'WeVid_Coverage_71ceabc.json').read_text())
tracked = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z']).decode().split('\0')[:-1]
paths = [item['path'] for item in coverage['files']]
source_bad = []
for item in coverage['files']:
    path = repo / item['path']
    data = path.readlink().as_posix().encode() if path.is_symlink() else path.read_bytes()
    if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        source_bad.append(item['path'])
manifest = json.loads((base / 'Evidence_Manifest.json').read_text())
local_bad = []
archive_bad = []
with zipfile.ZipFile(base / 'WeVid_Audit_Evidence_71ceabc.zip') as archive:
    crc_failure = archive.testzip()
    for name, metadata in manifest.items():
        local = base / name
        if not local.exists():
            local_bad.append(name)
        else:
            data = local.read_bytes()
            if len(data) != metadata['bytes'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
                local_bad.append(name)
        if name not in archive.namelist():
            archive_bad.append(name)
        else:
            data = archive.read(name)
            if len(data) != metadata['bytes'] or hashlib.sha256(data).hexdigest() != metadata['sha256']:
                archive_bad.append(name)
    unlisted = sorted(set(archive.namelist()) - set(manifest) - {'Evidence_Manifest.json'})
    manifest_matches = archive.read('Evidence_Manifest.json') == (base / 'Evidence_Manifest.json').read_bytes()
unit = json.loads((base / 'unit-tests-results.json').read_text())
result = {
    'method': 'Independent file-set, length, SHA256 and ZIP-CRC validation; does not prove that semantic review occurred',
    'head': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
    'tracked_count': len(tracked),
    'coverage_count': len(paths),
    'missing_paths': sorted(set(tracked) - set(paths)),
    'extra_paths': sorted(set(paths) - set(tracked)),
    'duplicate_paths': [key for key, count in collections.Counter(paths).items() if count > 1],
    'source_hash_mismatch': source_bad,
    'coverage_counts': dict(collections.Counter(item['status'] for item in coverage['files'])),
    'manifest_entries': len(manifest),
    'manifest_local_mismatch': local_bad,
    'manifest_archive_mismatch': archive_bad,
    'unlisted_archive_entries': unlisted,
    'archive_crc_failure': crc_failure,
    'manifest_copy_matches': manifest_matches,
    'recorded_unit_totals': {key: unit.get(key) for key in ['success', 'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']}
}
(base / 'verification-evidence-integrity.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))

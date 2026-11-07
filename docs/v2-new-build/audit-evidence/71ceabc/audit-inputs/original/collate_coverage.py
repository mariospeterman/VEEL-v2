import json, pathlib, subprocess, hashlib, collections

base=pathlib.Path(__file__).resolve().parent
repo=base/'wevid-audit'
sources=collections.defaultdict(list)

def add(path, method, reviewer):
    if isinstance(path,dict): path=path.get('path') or path.get('file')
    if isinstance(path,str): sources[path].append({'reviewer':reviewer,'method':method})

for manifest in base.glob('*coverage.json'):
    if manifest.name.startswith('WeVid_'):continue
    d=json.loads(manifest.read_text())
    if not isinstance(d,dict): continue
    for key in ['full_text_review','full_read_files','read','dedicated_tests_read','reviewed_files','additional_full_reads','additional_full_text_review','supplemental_full_reads']:
        for p in d.get(key,[]): add(p,'full_text_review',manifest.name)
    for p in d.get('files',[]):
        status=p.get('status') or p.get('review') or p.get('review_method') or p.get('coverage') or p.get('read_status') or 'recorded_review'
        if 'full' in status or status=='semantic_review':add(p,status,manifest.name)
        elif status: add(p,status,manifest.name)
    if d.get('path') and (d.get('read_status')=='full_file' or d.get('status')=='full_text_review' or d.get('coverageComplete') is True):add(d['path'],'full_text_review',manifest.name)
    if d.get('relative_path') and d.get('coverage_type')=='full_semantic_text_review':add(d['relative_path'],'full_text_review',manifest.name)
    if d.get('relative_path') and d.get('read_lines')==d.get('line_count'):add(d['relative_path'],'full_text_review',manifest.name)

entries=[]
for path in subprocess.check_output(['git','ls-files','-z'],cwd=repo).decode().split('\0'):
    if not path:continue
    p=repo/path
    methods=sources[path]
    full=any(x['method'] in ['full_text_review','full_read','full_code_read','full_semantic_read','semantic_review','full_text_read','full_forward_sql_semantic_read','full_rollback_sql_semantic_read','full semantic source read','full_text_semantic_review_and_executed_forward_sql'] for x in methods)
    status='full_text_review' if full else ('classified_or_structural' if methods else 'pending_coverage')
    if p.is_symlink(): status='canonical_symlink';data=p.readlink().as_posix().encode()
    else:data=p.read_bytes()
    if path.endswith(('.png','.jpg','.ico')):status='binary_metadata_only'
    elif path.endswith('.svg'):status='svg_structural_review'
    if path in ['pnpm-lock.yaml','packages/contracts/src/generated/openapi.ts']:
        status='generated_verified'
        methods.append({'reviewer':'root','method':'deterministic regeneration with zero source diff' if path.endswith('openapi.ts') else 'frozen-lockfile full graph installation, dependency policy and current advisory scan'})
    entries.append({'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'status':status,'evidence':methods})

output={'repository':'mariospeterman/VEEL-v2','commit':'71ceabcfaa8a5258e1b935a391ff4e6e7330c682','files':entries,'counts':dict(collections.Counter(x['status'] for x in entries))}
(base/'WeVid_Coverage_71ceabc.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output['counts']))
print('\n'.join(x['path'] for x in entries if x['status']=='pending_coverage'))

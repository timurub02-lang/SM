"""Package only the runtime; production data and secrets stay outside releases."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tarfile,tempfile

def package(commit,root=pathlib.Path('.')):
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Expected full commit SHA')
    standalone=root/'.next/standalone'
    if not (standalone/'server.js').is_file():raise RuntimeError('Build standalone first')
    shutil.copytree(root/'public',standalone/'public',dirs_exist_ok=True)
    shutil.copytree(root/'.next/static',standalone/'.next/static',dirs_exist_ok=True)
    jobs=list((root/'scripts').glob('sync-*.mjs'))
    if jobs:
        subprocess.run([str((root/'node_modules/.bin/esbuild').resolve()),*[str(p) for p in jobs],
                        '--bundle','--platform=node','--format=esm','--external:exceljs','--out-extension:.js=.mjs',
                        '--outdir='+str(standalone/'jobs')],check=True)
        if any(p.name=='sync-exports.mjs' for p in jobs):subprocess.run(['node',str(root/'scripts/trace-job-dependencies.mjs'),str(standalone)],check=True)
        env=os.environ.copy();env.pop('CRM_DATABASE_PATH',None);env.pop('NODE_PATH',None)
        # A repo-ancestor node_modules must not hide dependencies missing from the release.
        with tempfile.TemporaryDirectory(prefix='crm-isolated-jobs-') as folder:
            isolated=pathlib.Path(folder)
            shutil.copytree(standalone/'jobs',isolated/'jobs')
            if (standalone/'node_modules').exists():shutil.copytree(standalone/'node_modules',isolated/'node_modules')
            for job in (isolated/'jobs').glob('*.mjs'):
                probe=subprocess.run(['node',str(job)],cwd=isolated,env=env,capture_output=True,text=True,timeout=15)
                if probe.returncode==0 or 'CRM_DATABASE_PATH is required' not in probe.stderr:
                    raise RuntimeError('Background job failed isolated import check: '+job.name+'\n'+probe.stderr)
    (standalone/'release.json').write_text(json.dumps({'commit':commit,'format':1,**({'exports':1} if any(p.name=='sync-exports.mjs' for p in jobs) else {}),**({'maintenance':1} if any(p.name=='sync-maintenance.mjs' for p in jobs) else {}),**({'summaries':1} if any(p.name=='sync-summaries.mjs' for p in jobs) else {}),**({'skEvents':1} if any(p.name=='sync-sk-events.mjs' for p in jobs) else {}),**({'lvIncoming':1} if any(p.name=='sync-lv-incoming.mjs' for p in jobs) else {})})+'\n')
    output=root/'dist';output.mkdir(exist_ok=True)
    def allowed(info):
        parts=pathlib.PurePosixPath(info.name).parts
        if any(x in {'.git','cache'} or x.startswith('.env') for x in parts):return None
        if info.name.endswith(('.sqlite','.sqlite-wal','.sqlite-shm','.db')):return None
        info.uid=info.gid=0;info.uname=info.gname='';return info
    archive=output/'crm-runtime.tgz'
    with tarfile.open(archive,'w:gz') as out:out.add(standalone,arcname='runtime',filter=allowed)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    (output/'SHA256SUMS').write_text(digest+'  crm-runtime.tgz\n')
    print(json.dumps({'commit':commit,'bytes':archive.stat().st_size,'sha256':digest}))

if __name__=='__main__':package(sys.argv[1])

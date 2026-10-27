"""Package only the runtime; production data and secrets stay outside releases."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,tarfile

def package(commit,root=pathlib.Path('.')):
    if not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('Expected full commit SHA')
    standalone=root/'.next/standalone'
    if not (standalone/'server.js').is_file():raise RuntimeError('Build standalone first')
    shutil.copytree(root/'public',standalone/'public',dirs_exist_ok=True)
    shutil.copytree(root/'.next/static',standalone/'.next/static',dirs_exist_ok=True)
    jobs=list((root/'scripts').glob('sync-*.mjs'))
    if jobs:
        subprocess.run([str((root/'node_modules/.bin/esbuild').resolve()),*[str(p) for p in jobs],
                        '--bundle','--platform=node','--format=esm','--out-extension:.js=.mjs',
                        '--outdir='+str(standalone/'jobs')],check=True)
        env=os.environ.copy();env.pop('CRM_DATABASE_PATH',None)
        for job in (standalone/'jobs').glob('*.mjs'):
            probe=subprocess.run(['node',str(job)],env=env,capture_output=True,text=True,timeout=15)
            if probe.returncode==0 or 'CRM_DATABASE_PATH is required' not in probe.stderr:
                raise RuntimeError('Background job failed import check: '+job.name+'\n'+probe.stderr)
    (standalone/'release.json').write_text(json.dumps({'commit':commit,'format':1})+'\n')
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

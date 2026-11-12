#!/usr/bin/env python3
"""Pull verified GitHub runtimes. Optional read-only GitHub credential stays outside the runtime."""
import argparse,fcntl,hashlib,http.client,json,os,pathlib,re,shutil,socket,sqlite3,stat,subprocess,tarfile,tempfile,time,urllib.request,urllib.error,urllib.parse

BASE=pathlib.Path('/srv/crm')
REPO='timurub02-lang/SM'
API='https://api.github.com/repos/'+REPO
NAME=re.compile(r'(?:gh|saved)-[0-9a-f]{40}')

def github_token():
    """Opt in through a root-owned file path, never an environment token value."""
    path=os.environ.get('SM_CRM_GITHUB_TOKEN_FILE')
    if path is None:return None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'r',encoding='ascii') as source:
            info=os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o600:
                raise ValueError('Unsafe credential file')
            token=source.read(4097).strip()
            if not re.fullmatch(r'[A-Za-z0-9_]{20,4096}',token):raise ValueError('Invalid credential')
            return token
    except Exception:
        raise RuntimeError('Cannot load GitHub credential; check root ownership, mode 0600 and token validity') from None

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        # urllib otherwise forwards regular headers, including Authorization.
        target=urllib.parse.urlsplit(newurl)
        if target.scheme!='https' or target.username or target.password:
            raise ValueError('Unsafe download redirect')
        redirected=super().redirect_request(req,fp,code,msg,headers,newurl)
        if redirected is not None:redirected.remove_header('Authorization')
        return redirected

def get(url,limit=4*1024*1024,accept='application/vnd.github+json',timeout=45):
    headers={'User-Agent':'sm-crm-deploy','Accept':accept}
    # Never read or attach a credential to local CRM health checks or asset CDNs.
    if url.startswith(API+'/'):
        token=github_token()
        if token:headers['Authorization']='Bearer '+token
    request=urllib.request.Request(url,headers=headers)
    try:
        with urllib.request.build_opener(SafeRedirect()).open(request,timeout=timeout) as response:
            data=response.read(limit+1)
    except urllib.error.HTTPError as error:
        raise RuntimeError('Download failed (HTTP '+str(error.code)+'); check GitHub access/rate limits or CRM health') from None
    except Exception:
        # Redirect URLs can be signed; neither URL nor exception payload is logged.
        raise RuntimeError('Download failed; check network and TLS connectivity') from None
    if len(data)>limit:raise ValueError('Download too large')
    return data

def release_asset(asset,limit):
    asset_id=asset.get('id')
    if type(asset_id) is not int or asset_id<=0:raise ValueError('Invalid release asset ID')
    # Construct the API endpoint, do not trust URLs from release metadata.
    return get(API+'/releases/assets/'+str(asset_id),limit,'application/octet-stream')

def extract(archive,directory):
    with tarfile.open(archive) as tar:
        members=tar.getmembers()
        if sum(m.size for m in members)>1024**3:raise ValueError('Expanded runtime too large')
        for member in members:
            parts=pathlib.PurePosixPath(member.name).parts
            if not parts or parts[0]!='runtime' or '..' in parts or member.name.startswith('/'):
                raise ValueError('Unsafe runtime path')
            if not (member.isfile() or member.isdir()):raise ValueError('Runtime must contain regular files only')
            if '.git' in parts or any(p.startswith('.env') for p in parts):raise ValueError('Unexpected repository or environment file')
        tar.extractall(directory,filter='data')

def current():return (BASE/'current').resolve(strict=True)

def write_json(path,value):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');os.replace(tmp,path)

def idle():
    with sqlite3.connect('file:/var/lib/sm-crm/crm.sqlite?mode=ro',uri=True) as db:
        busy=db.execute("SELECT count(*) FROM phone_calls WHERE ended_at IS NULL AND status IN ('preparing','dialing','connected') AND julianday(started_at)>julianday('now','-32 minutes')").fetchone()[0]
    class Unix(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(5);self.sock.connect('/run/sm-oktell-bridge/control.sock')
    conn=Unix('localhost');conn.request('GET','/deployment-state');response=conn.getresponse();state=json.loads(response.read());conn.close()
    if response.status!=200 or not isinstance(state,dict) or type(state.get('busy')) is not bool:raise RuntimeError('Cannot verify phone state')
    return not busy and not state['busy']

def healthy():
    for _ in range(30):
        try:
            body=get('http://127.0.0.1:3000/login')
            if b'<html' not in body:raise ValueError('Invalid login response')
            scripts=re.findall(rb'src="(/_next/static/[^"?]+\.js)',body)
            if not scripts:raise ValueError('Login has no application scripts')
            for script in scripts:get('http://127.0.0.1:3000'+script.decode(),16*1024*1024)
            return
        except Exception:time.sleep(1)
    raise RuntimeError('CRM health check failed')

def switch(target):
    link=BASE/'current.next';link.unlink(missing_ok=True);link.symlink_to(target);os.replace(link,BASE/'current')
    subprocess.run(['systemctl','restart','sm-crm'],check=True);healthy()
    # Long-lived derived-data code must follow current; deliberately stopped workers stay stopped.
    for service in ['sm-crm-summaries','sm-crm-sk-events']:
        if subprocess.run(['systemctl','is-active','--quiet',service],check=False).returncode==0:
            subprocess.run(['systemctl','try-restart',service],check=True)
    service='sm-crm-legacy-snapshots'
    if subprocess.run(['systemctl','is-active','--quiet',service],check=False).returncode==0:
        if json.loads((target/'release.json').read_text()).get('legacySnapshots')!=1:
            subprocess.run(['systemctl','stop',service],check=True)
        else:
            subprocess.run(['systemctl','try-restart',service],check=True)
            for _ in range(15):
                try:
                    if json.loads(get('http://127.0.0.1:3101/api/crm-worker-health',1024,timeout=2)).get('ok') is True:break
                except Exception:pass
                time.sleep(1)
            else:raise RuntimeError('CRM legacy snapshot worker health check failed')

def retain(history,live):
    if live.parent!=BASE/'releases' or not NAME.fullmatch(live.name):raise ValueError('Unexpected current release')
    keep=list(dict.fromkeys([live.name]+history))[:3]
    # Only our explicitly managed immutable runtime directories may be removed.
    for path in (BASE/'releases').iterdir():
        if path.name in keep or not NAME.fullmatch(path.name) or path.is_symlink():continue
        if path.resolve().parent!=BASE/'releases' or not (path/'release.json').is_file():continue
        shutil.rmtree(path)
    return keep

def activate(target,previous,state):
    if current()!=previous:raise RuntimeError('Current release changed during deployment')
    if not idle():return False
    backup=BASE/'backups/deploy-latest.sqlite';backup.parent.mkdir(exist_ok=True)
    with sqlite3.connect('file:/var/lib/sm-crm/crm.sqlite?mode=ro',uri=True) as src,sqlite3.connect(str(backup)+'.tmp') as dst:src.backup(dst)
    os.chmod(str(backup)+'.tmp',0o600);os.replace(str(backup)+'.tmp',backup)
    try:switch(target)
    except Exception:
        switch(previous)
        raise
    state['history']=retain([previous.name]+state.get('history',[]),target)
    state['current']=target.name;state['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    write_json(BASE/'deploy-state.json',state)
    return True

def run(rollback=None):
    state=json.loads((BASE/'deploy-state.json').read_text());previous=current()
    if (BASE/'deploy-paused').exists() and not rollback:print('Automatic deployment is paused');return
    if not NAME.fullmatch(previous.name):raise RuntimeError('Legacy publication detected; reconcile source before resuming')
    if rollback:
        if rollback not in state['history'] or not NAME.fullmatch(rollback):raise ValueError('Choose an available rollback release')
        target=BASE/'releases'/rollback
        if target==previous:print('Already current');return
        # A manual rollback stays in place until the operator explicitly removes the pause file.
        (BASE/'deploy-paused').touch()
        print('Rollback applied' if activate(target,previous,state) else 'Active call; retry rollback later');return
    release=json.loads(get(API+'/releases/latest'))
    tag=release.get('tag_name','')
    if release.get('draft') or release.get('prerelease') or not re.fullmatch(r'crm-[0-9a-f]{40}',tag):raise ValueError('Not a production CRM release')
    sha=tag[4:];name='gh-'+sha
    if previous.name==name:print('Already current: '+sha);return
    if json.loads(get(API+'/commits/main'))['sha']!=sha:print('Waiting for the latest main build');return
    if not idle():print('Active call; update deferred');return
    if shutil.disk_usage(BASE).free<1024**3:raise RuntimeError('Need at least 1 GiB free')
    assets={a['name']:a for a in release['assets']}
    def asset(name,limit):
        return release_asset(assets[name],limit)
    sums=asset('SHA256SUMS',512).decode().strip()
    if not re.fullmatch(r'[0-9a-f]{64}  crm-runtime\.tgz',sums):raise ValueError('Invalid checksum manifest')
    data=asset('crm-runtime.tgz',200*1024*1024)
    if hashlib.sha256(data).hexdigest()!=sums[:64]:raise ValueError('Runtime checksum mismatch')
    target=BASE/'releases'/name
    if target.exists():
        # Only a prior, fully staged retry can already exist.
        if json.loads((target/'release.json').read_text()).get('commit')!=sha:raise ValueError('Existing release mismatch')
    else:
        with tempfile.TemporaryDirectory(prefix='.incoming-',dir=BASE) as tmp:
            tmp=pathlib.Path(tmp);archive=tmp/'runtime.tgz';archive.write_bytes(data);extract(archive,tmp)
            runtime=tmp/'runtime';meta=json.loads((runtime/'release.json').read_text())
            if meta.get('commit')!=sha or meta.get('format')!=1 or not (runtime/'server.js').is_file():raise ValueError('Runtime identity mismatch')
            staged=tmp/'release';(staged/'.next').mkdir(parents=True)
            validate_jobs(runtime/'jobs',meta)
            (runtime/'jobs').rename(staged/'scripts');runtime.rename(staged/'.next/standalone')
            link_job_dependencies(staged)
            static=staged/'.next/standalone/.next/static'
            meta['staticFiles']=[p.relative_to(static).as_posix() for p in static.rglob('*') if p.is_file()]
            # Serve immutable chunks from the two preceding builds for already open browser tabs.
            for old_name in list(dict.fromkeys([previous.name]+state['history']))[:2]:
                old=BASE/'releases'/old_name;old_meta=json.loads((old/'release.json').read_text())
                for relative in old_meta['staticFiles']:
                    if '..' in pathlib.PurePosixPath(relative).parts or relative.startswith('/'):raise ValueError('Unsafe static asset')
                    dest=static/relative;src=old/'.next/standalone/.next/static'/relative
                    if not dest.exists():dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
            write_json(staged/'release.json',meta)
            subprocess.run(['chown','-R','crmadmin:crmadmin',str(staged)],check=True);staged.rename(target)
    if json.loads(get(API+'/commits/main'))['sha']!=sha:print('A newer commit arrived; update deferred');return
    print('Deployed '+sha if activate(target,previous,state) else 'Active call; update deferred')

def link_job_dependencies(staged):
    # Jobs live at release/scripts; the web bundle keeps its traced dependencies inside standalone.
    dependencies=staged/'.next/standalone/node_modules'
    if dependencies.is_symlink() or not dependencies.is_dir():raise ValueError('Missing trusted runtime dependencies')
    (staged/'node_modules').symlink_to('.next/standalone/node_modules',target_is_directory=True)

def validate_jobs(path,meta):
    expected={'sync-activity.mjs','sync-base.mjs','sync-cdek-deletions.mjs','sync-cdek-shipments.mjs','sync-lv-warehouse.mjs','sync-redemption.mjs','sync-sk-orders.mjs'}
    if meta.get('maintenance')==1:expected.add('sync-maintenance.mjs')
    if meta.get('exports')==1:expected.add('sync-exports.mjs')
    if meta.get('summaries')==1:expected.add('sync-summaries.mjs')
    if meta.get('skEvents')==1:expected.add('sync-sk-events.mjs')
    if meta.get('lvIncoming')==1:expected.add('sync-lv-incoming.mjs')
    if {p.name for p in path.glob('sync-*.mjs')}!=expected:raise ValueError('Background jobs are missing or unexpected')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--rollback');args=parser.parse_args()
    with open('/run/lock/sm-crm-deploy.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Another deployment is running')
        run(args.rollback)

#!/usr/bin/env python3
"""Pull verified GitHub runtimes. No GitHub or SSH secret is needed on this host."""
import argparse,fcntl,hashlib,http.client,json,os,pathlib,re,shutil,socket,sqlite3,subprocess,tarfile,tempfile,time,urllib.request

BASE=pathlib.Path('/srv/crm')
REPO='timurub02-lang/SM'
API='https://api.github.com/repos/'+REPO
NAME=re.compile(r'(?:gh|saved)-[0-9a-f]{40}')

def get(url,limit=4*1024*1024):
    request=urllib.request.Request(url,headers={'User-Agent':'sm-crm-deploy','Accept':'application/vnd.github+json'})
    with urllib.request.urlopen(request,timeout=45) as response:
        data=response.read(limit+1)
    if len(data)>limit:raise ValueError('Download too large')
    return data

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
    conn=Unix('localhost');conn.request('GET','/browser-phone');response=conn.getresponse();state=json.loads(response.read());conn.close()
    if response.status!=200:raise RuntimeError('Cannot verify phone state')
    return not busy and not state.get('calling')

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
        url=assets[name]['browser_download_url']
        if not url.startswith('https://github.com/'+REPO+'/releases/download/'+tag+'/'):raise ValueError('Unexpected asset origin')
        return get(url,limit)
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
            staged=tmp/'release';(staged/'.next').mkdir(parents=True);runtime.rename(staged/'.next/standalone')
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

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--rollback');args=parser.parse_args()
    with open('/run/lock/sm-crm-deploy.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Another deployment is running')
        run(args.rollback)

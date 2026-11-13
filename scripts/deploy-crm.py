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

def atomic_text(path,text):
    tmp=path.with_suffix('.tmp')
    with tmp.open('w') as output:
        output.write(text);output.flush();os.fsync(output.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def write_json(path,value):atomic_text(path,json.dumps(value,indent=2)+'\n')

def remove_journal(path):
    path.unlink()
    fd=os.open(path.parent,os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def idle():
    with sqlite3.connect('file:/var/lib/sm-crm/crm.sqlite?mode=ro',uri=True) as db:
        busy=db.execute("SELECT count(*) FROM phone_calls WHERE ended_at IS NULL AND status IN ('preparing','dialing','connected') AND julianday(started_at)>julianday('now','-32 minutes')").fetchone()[0]
    class Unix(http.client.HTTPConnection):
        def connect(self):
            self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(5);self.sock.connect('/run/sm-oktell-bridge/control.sock')
    conn=Unix('localhost');conn.request('GET','/deployment-state');response=conn.getresponse();state=json.loads(response.read());conn.close()
    if response.status!=200 or not isinstance(state,dict) or type(state.get('busy')) is not bool:raise RuntimeError('Cannot verify phone state')
    return not busy and not state['busy']

def healthy(port=3000):
    for _ in range(30):
        try:
            body=get('http://127.0.0.1:'+str(port)+'/login',timeout=3)
            if b'<html' not in body:raise ValueError('Invalid login response')
            scripts=re.findall(rb'src="(/_next/static/[^"?]+\.js)',body)
            if not scripts:raise ValueError('Login has no application scripts')
            for script in scripts:get('http://127.0.0.1:'+str(port)+script.decode(),16*1024*1024,timeout=3)
            return
        except Exception:time.sleep(1)
    raise RuntimeError('CRM health check failed')

def switch(target,restore_legacy=False):
    link=BASE/'current.next';link.unlink(missing_ok=True);link.symlink_to(target);os.replace(link,BASE/'current')
    subprocess.run(['systemctl','restart','sm-crm'],check=True);healthy()
    # Long-lived derived-data code must follow current; deliberately stopped workers stay stopped.
    for service in ['sm-crm-summaries','sm-crm-sk-events']:
        if subprocess.run(['systemctl','is-active','--quiet',service],check=False).returncode==0:
            subprocess.run(['systemctl','try-restart',service],check=True)
    service='sm-crm-legacy-snapshots'
    if restore_legacy or subprocess.run(['systemctl','is-active','--quiet',service],check=False).returncode==0:
        if json.loads((target/'release.json').read_text()).get('legacySnapshots')!=1:
            subprocess.run(['systemctl','stop',service],check=True)
        else:
            subprocess.run(['systemctl','restart' if restore_legacy else 'try-restart',service],check=True)
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
        if path.name in keep or path.name in slot_releases() or not NAME.fullmatch(path.name) or path.is_symlink():continue
        if path.resolve().parent!=BASE/'releases' or not (path/'release.json').is_file():continue
        shutil.rmtree(path)
    if (BASE/'blue-green.json').exists():publish_static(keep+slot_releases(),prune=True)
    return keep

def activate(target,previous,state):
    if current()!=previous:raise RuntimeError('Current release changed during deployment')
    if not idle():return False
    backup=BASE/'backups/deploy-latest.sqlite';backup.parent.mkdir(exist_ok=True)
    with sqlite3.connect('file:/var/lib/sm-crm/crm.sqlite?mode=ro',uri=True) as src,sqlite3.connect(str(backup)+'.tmp') as dst:src.backup(dst)
    os.chmod(str(backup)+'.tmp',0o600);os.replace(str(backup)+'.tmp',backup)
    if (BASE/'blue-green.json').exists():return activate_slots(target,previous,state)
    # A failed new worker may already be inactive when automatic rollback begins.
    legacy_was_active=subprocess.run(['systemctl','is-active','--quiet','sm-crm-legacy-snapshots'],check=False).returncode==0
    try:switch(target)
    except Exception:
        switch(previous,restore_legacy=legacy_was_active)
        raise
    state['history']=retain([previous.name]+state.get('history',[]),target)
    state['current']=target.name;state['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    write_json(BASE/'deploy-state.json',state)
    return True

def run(rollback=None):
    recover_slots()
    if not reap_slots() and not rollback:print('Previous Nginx connections are draining; update deferred');return
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

SLOTS={'blue':(3000,3101),'green':(3002,3102)}
UPSTREAM=pathlib.Path('/etc/nginx/conf.d/sm-crm-upstream.conf')
NGINX_PID=pathlib.Path('/run/nginx.pid')
PROBE_PORT=3099

def slots():
    path=BASE/'blue-green.json'
    if not path.exists():return None
    value=json.loads(path.read_text())
    if value.get('active') not in SLOTS:raise ValueError('Invalid active slot')
    for name,slot in value['slots'].items():
        if name not in SLOTS or not NAME.fullmatch(slot['release']):raise ValueError('Invalid slot identity')
    return value

def slot_releases():
    state=slots()
    return [s['release'] for s in state['slots'].values()] if state else []

def publish_static(names,prune=False):
    root=BASE/'static';root.mkdir(exist_ok=True);root.chmod(0o755);keep=set()
    for name in set(names):
        if not NAME.fullmatch(name):raise ValueError('Invalid static release')
        release=BASE/'releases'/name
        for relative in json.loads((release/'release.json').read_text())['staticFiles']:
            path=pathlib.PurePosixPath(relative)
            if path.is_absolute() or '..' in path.parts:raise ValueError('Unsafe static path')
            src=release/'.next/standalone/.next/static'/path;dest=root/path;keep.add(dest)
            if dest.exists():
                if hashlib.sha256(dest.read_bytes()).digest()!=hashlib.sha256(src.read_bytes()).digest():raise ValueError('Immutable asset collision')
            else:
                dest.parent.mkdir(parents=True,exist_ok=True)
                for parent in dest.parents:
                    if parent==root:break
                    parent.chmod(0o755)
                tmp=dest.with_suffix(dest.suffix+'.tmp');shutil.copyfile(src,tmp);tmp.chmod(0o644);os.replace(tmp,dest)
    if prune:
        for path in root.rglob('*'):
            if path.is_file() and path not in keep:path.unlink()

def service_names(name,slot):
    return ['sm-crm','sm-crm-legacy-snapshots'] if slot.get('legacy') else ['sm-crm-web@'+name,'sm-crm-snapshot@'+name]

def process_identity(pid):
    try:
        fields=pathlib.Path('/proc/'+str(int(pid))+'/stat').read_text().rsplit(')',1)[1].split()
        return [int(pid),fields[19],pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()]
    except FileNotFoundError:return None

def nginx_workers():
    master=int(NGINX_PID.read_text())
    children=pathlib.Path('/proc/'+str(master)+'/task/'+str(master)+'/children').read_text().split()
    return [identity for pid in children if (identity:=process_identity(pid))]

def route_slot(name,slot):
    port=SLOTS[name][0];release=slot['release']
    atomic_text(UPSTREAM, 'upstream sm_crm_web { server 127.0.0.1:'+str(port)+'; }\n'
        'server { listen 127.0.0.1:'+str(PROBE_PORT)+'; server_name localhost;\n'
        ' location / { proxy_pass http://sm_crm_web; proxy_set_header Host crm.smanalytics.ru;\n'
        ' add_header X-SM-Release "'+release+'" always; }\n}\n')
    subprocess.run(['nginx','-t'],check=True,capture_output=True)
    subprocess.run(['systemctl','reload','nginx'],check=True)
    # A successful signal is not proof that new workers loaded this generation.
    for _ in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:'+str(PROBE_PORT)+'/login',timeout=3) as response:
                if response.status==200 and response.headers.get('X-SM-Release')==release and b'<html' in response.read(1024*1024):return
        except Exception:pass
        time.sleep(.2)
    raise RuntimeError('Nginx did not serve the selected release')

def point_current(target):
    link=BASE/'current.next';link.unlink(missing_ok=True);link.symlink_to(target);os.replace(link,BASE/'current')
    fd=os.open(BASE,os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def restart_workers():
    for service in ['sm-crm-summaries','sm-crm-sk-events']:
        if subprocess.run(['systemctl','is-active','--quiet',service],check=False).returncode==0:
            subprocess.run(['systemctl','try-restart',service],check=True)

def prepare_slot(name,target):
    for service in service_names(name,{}):
        result=subprocess.run(['systemctl','show',service,'--property=ActiveState','--value'],check=True,capture_output=True,text=True)
        if result.stdout.strip() not in ('inactive','failed'):raise RuntimeError('Candidate slot is still running')
    if json.loads((target/'release.json').read_text()).get('legacySnapshots')!=1:raise RuntimeError('Slot deployment requires compatible snapshot runtime')
    memory=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
    if int(memory['MemAvailable'].split()[0])<4*1024*1024:raise RuntimeError('Need 4 GiB available for candidate pair')
    directory=BASE/'slots';directory.mkdir(exist_ok=True);directory.chmod(0o755)
    link=directory/name;link.unlink(missing_ok=True);link.symlink_to(target)
    web,snapshot=SLOTS[name]
    atomic_text(directory/(name+'.env'),'PORT='+str(web)+'\nSNAPSHOT_PORT='+str(snapshot)+'\nCRM_LEGACY_SNAPSHOT_ORIGIN=http://127.0.0.1:'+str(snapshot)+'\n')
    services=service_names(name,{})
    subprocess.run(['systemctl','enable',*services],check=True)
    subprocess.run(['systemctl','start',services[1]],check=True)
    for _ in range(30):
        try:
            if json.loads(get('http://127.0.0.1:'+str(snapshot)+'/api/crm-worker-health',1024,timeout=2)).get('ok') is True:break
        except Exception:pass
        time.sleep(1)
    else:raise RuntimeError('Candidate snapshot worker unhealthy')
    subprocess.run(['systemctl','start',services[0]],check=True);healthy(web)

def reap_slots():
    state=slots()
    if not state or not state.get('draining'):return True
    drain=state['draining']
    # Include old Nginx workers: buffered uploads may not yet have an upstream socket.
    # shortcut: long-lived phone WebSockets defer reuse of this slot; never truncate them.
    if any(process_identity(identity[0])==identity for identity in drain['workers']):return False
    name=drain['slot']
    if name==state['active']:raise RuntimeError('Refusing to stop active slot')
    for service in service_names(name,state['slots'][name]):
        subprocess.run(['systemctl','stop',service],check=True)
        subprocess.run(['systemctl','disable',service],check=True)
    del state['slots'][name];del state['draining'];write_json(BASE/'blue-green.json',state)
    return True

def recover_slots():
    journal=BASE/'blue-green-pending.json'
    if not journal.exists():return
    pending=json.loads(journal.read_text());state=pending['before'];old=state['active'];candidate=pending['candidate']
    # Recovery always returns to the retained old process; never restores an old database.
    healthy(SLOTS[old][0]);workers=nginx_workers();route_slot(old,state['slots'][old])
    point_current(BASE/'releases'/state['slots'][old]['release']);restart_workers()
    state['slots'][candidate]=pending['slot']
    state['draining']={'slot':candidate,'workers':workers}
    write_json(BASE/'blue-green.json',state);write_json(BASE/'deploy-state.json',pending['deployState'])
    (BASE/'deploy-paused').touch();remove_journal(journal)

def activate_slots(target,previous,deploy_state):
    state=slots();old=state['active'];candidate='green' if old=='blue' else 'blue'
    retained=state['slots'].get(candidate)
    reuse=retained is not None and retained['release']==target.name
    if not reuse and (state.get('draining') or len(state['slots'])!=1):raise RuntimeError('Previous slot has not drained')
    if state['slots'][old]['release']!=previous.name:raise RuntimeError('Slot and current differ')
    journal=BASE/'blue-green-pending.json'
    pending={'before':state,'candidate':candidate,'slot':retained if reuse else {'release':target.name},'deployState':deploy_state}
    write_json(journal,pending)
    try:
        publish_static([target.name]+deploy_state['history']+slot_releases())
        if reuse:healthy(SLOTS[candidate][0])
        else:prepare_slot(candidate,target)
        if not idle():raise RuntimeError('Active call before traffic switch; candidate deferred')
        workers=nginx_workers();route_slot(candidate,pending['slot'])
        point_current(target);restart_workers()
        state['slots'][candidate]=pending['slot'];state['active']=candidate
        state['draining']={'slot':old,'workers':workers};write_json(BASE/'blue-green.json',state)
        deploy_state['current']=target.name
        deploy_state['history']=list(dict.fromkeys([target.name,previous.name]+deploy_state.get('history',[])))[:3]
        deploy_state['updatedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        write_json(BASE/'deploy-state.json',deploy_state)
        remove_journal(journal)
    except Exception:
        recover_slots();raise
    reap_slots();retain(deploy_state['history'],target)
    return True

def initialize_slots():
    if not (BASE/'deploy-paused').exists():raise RuntimeError('Pause publication before installing slot infrastructure')
    if slots():raise RuntimeError('Slots already initialized')
    previous=current();state=json.loads((BASE/'deploy-state.json').read_text())
    if previous.name!=state['current'] or not NAME.fullmatch(previous.name):raise RuntimeError('Current and deployment state differ')
    healthy();publish_static([previous.name]+state['history'])
    slot={'release':previous.name,'legacy':True}
    route_slot('blue',slot)
    write_json(BASE/'blue-green.json',{'active':'blue','slots':{'blue':slot}})

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
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group();group.add_argument('--rollback');group.add_argument('--init-blue-green',action='store_true');args=parser.parse_args()
    with open('/run/lock/sm-crm-deploy.lock','w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('Another deployment is running')
        if args.init_blue_green:initialize_slots()
        else:run(args.rollback)

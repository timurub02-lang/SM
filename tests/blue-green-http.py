"""Real Nginx reload, buffered POST, shared SQLite and a persistent upgraded connection.
Run on Linux with nginx installed; all listeners and data are isolated temporary fixtures.
"""
import concurrent.futures,hashlib,http.client,http.server,importlib.util,json,os,pathlib,shutil,signal,socket,sqlite3,subprocess,sys,tempfile,threading,time,urllib.request
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy',root/'scripts/deploy-crm.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
assert shutil.which('nginx'),'nginx is required, never silently skip this acceptance test'
router='--router' in sys.argv
def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='crm-blue-green-') as folder:
    base=pathlib.Path(folder);os.chmod(base,0o755);dbfile=base/'synthetic.sqlite'
    with sqlite3.connect(dbfile) as db:db.execute('pragma journal_mode=WAL');db.execute('create table writes(id text primary key, version text)')
    ports={name:(port(),port()) for name in ['blue','green']};public=port();entry=port() if router else public;probe=port();errors=[];stop=threading.Event();upgraded=threading.Event();release_ws=threading.Event();saved=[]
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path=='/ws':
                self.send_response(101);self.send_header('Upgrade','fixture');self.send_header('Connection','upgrade');self.end_headers();upgraded.set();self.connection.settimeout(.1)
                while not release_ws.is_set():
                    try:
                        message=self.connection.recv(1024)
                        if not message:break
                        self.connection.sendall(message)
                    except socket.timeout:pass
                    except OSError:break
                return
            body=json.dumps({name:self.headers.get(name) for name in ['Host','X-Forwarded-Proto','X-Forwarded-For','X-Real-IP','Authorization','Cookie']}).encode() if self.path=='/headers' else b'<html><script src="/_next/static/test.js"></script></html>' if self.path=='/login' else self.server.version.encode()
            self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            data=self.rfile.read(int(self.headers['Content-Length']));identifier='large-'+hashlib.sha256(data).hexdigest() if self.path=='/large' else data.decode()
            with sqlite3.connect(dbfile,timeout=5) as db:db.execute('insert into writes values(?,?)',(identifier,self.server.version))
            body=self.server.version.encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    servers=[]
    for name in ports:
        server=http.server.ThreadingHTTPServer(('127.0.0.1',ports[name][0]),Handler);server.daemon_threads=True;server.version=name;threading.Thread(target=server.serve_forever,daemon=True).start();servers.append(server)
    config=base/'nginx.conf';pid=base/'nginx.pid';upstream=base/'upstream.conf'
    upstream.write_text('upstream sm_crm_web { server 127.0.0.1:'+str(ports['blue'][0])+'; }\n')
    config.write_text('pid '+str(pid)+';\nerror_log '+str(base/'error.log')+';\nevents {}\nhttp { access_log off; client_body_temp_path '+str(base/'body')+'; proxy_temp_path '+str(base/'proxy')+'; include '+str(upstream)+'; server { listen 127.0.0.1:'+str(public)+'; location / { proxy_pass http://sm_crm_web; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; } } }\n')
    edgepid=base/'edge.pid';edgeconfig=base/'edge.conf'
    if router:
        template=(root/'deploy/sm-crm-router.conf').read_text().replace('user www-data;','').replace('/run/sm-crm-router',str(base/'router-run')).replace('/var/log/nginx/sm-crm-router.error.log',str(base/'router-error.log')).replace('/etc/nginx/sm-crm-router/upstream.conf',str(upstream)).replace('127.0.0.1:3098','127.0.0.1:'+str(entry))
        (base/'router-run').mkdir();pid=base/'router-run/nginx.pid';config.write_text(template)
        phone=http.server.ThreadingHTTPServer(('127.0.0.1',port()),Handler);phone.daemon_threads=True;phone.version='phone';threading.Thread(target=phone.serve_forever,daemon=True).start();servers.append(phone)
        # The public proxy buffers uploads and owns phone tunnels; it is never reloaded by CRM publication.
        edgeconfig.write_text('pid '+str(edgepid)+'; error_log '+str(base/'edge-error.log')+'; events {} http { access_log off; client_body_temp_path '+str(base/'edge-body')+'; server { listen 127.0.0.1:'+str(public)+'; client_max_body_size 45m; location /ws { proxy_pass http://127.0.0.1:'+str(phone.server_port)+'; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; } location / { proxy_pass http://127.0.0.1:'+str(entry)+'; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Real-IP $remote_addr; } } }')
    subprocess.run(['nginx','-p',folder,'-c',str(config)],check=True)
    if router:subprocess.run(['nginx','-p',folder,'-c',str(edgeconfig)],check=True)
    old_run=subprocess.run
    stopped=[]
    def command(args,**kwargs):
        if args==['nginx','-t'] or args==['nginx','-t','-c',str(config)]:return old_run(['nginx','-t','-p',folder,'-c',str(config)],**kwargs)
        if args==['systemctl','reload','sm-crm-router' if router else 'nginx']:os.kill(int(pid.read_text()),signal.SIGHUP);return subprocess.CompletedProcess(args,0)
        if args[:2]==['systemctl','stop']:stopped.append(args[-1])
        return subprocess.CompletedProcess(args,0,stdout='inactive\n')
    def read(path='/'):
        with urllib.request.urlopen('http://127.0.0.1:'+str(public)+path,timeout=5) as response:return response.read().decode()
    def traffic():
        for i in range(100):
            if stop.is_set():break
            try:
                assert read() in ('blue','green')
                req=urllib.request.Request('http://127.0.0.1:'+str(public)+'/save',data=('save-'+str(i)).encode())
                with urllib.request.urlopen(req,timeout=5) as response:assert response.status==200;saved.append(i)
            except Exception as error:errors.append(str(error))
            time.sleep(.02)
    def phone_ping():
        ws.sendall(b'phone-alive');assert ws.recv(1024)==b'phone-alive','phone tunnel was interrupted'
    ws=None;upload=None;edge_upload=None
    try:
        for letter in ['a','b']:
            path=base/'releases'/('gh-'+letter*40);static=path/'.next/standalone/.next/static';static.mkdir(parents=True);(static/(letter+'.js')).write_text(letter)
            (path/'release.json').write_text(json.dumps({'staticFiles':[letter+'.js'],'legacySnapshots':1}))
        old=base/'releases'/('gh-'+'a'*40);new=base/'releases'/('gh-'+'b'*40);(base/'current').symlink_to(old)
        state={'current':old.name,'history':[old.name]};(base/'deploy-state.json').write_text(json.dumps(state));(base/'blue-green.json').write_text(json.dumps({'active':'blue','slots':{'blue':{'release':old.name}}}))
        ws=socket.create_connection(('127.0.0.1',public));ws.sendall(b'GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');assert b'101' in ws.recv(2048);assert upgraded.wait(2)
        ws.settimeout(5);phone_ping()
        edge_workers=pathlib.Path('/proc/'+edgepid.read_text().strip()+'/task/'+edgepid.read_text().strip()+'/children').read_text() if router else None
        # Body remains buffered in OLD Nginx, with no upstream TCP socket yet.
        upload=http.client.HTTPConnection('127.0.0.1',entry,timeout=10);upload.putrequest('POST','/save');upload.putheader('Content-Length','12');upload.endheaders();upload.send(b'long-');time.sleep(.1)
        if router:
            edge_upload=http.client.HTTPConnection('127.0.0.1',public,timeout=10);edge_upload.putrequest('POST','/save');edge_upload.putheader('Content-Length','12');edge_upload.endheaders();edge_upload.send(b'edge-');time.sleep(.1)
        thread=threading.Thread(target=traffic);thread.start()
        with patch.object(d,'BASE',base),patch.object(d,'UPSTREAM',upstream),patch.object(d,'NGINX_PID',pid),patch.object(d,'PROBE_PORT',probe),patch.object(d,'ROUTER_CONFIG',config if router else base/'not-installed.conf'),patch.object(d,'ROUTER_UPSTREAM',upstream),patch.object(d,'ROUTER_PID',pid),patch.object(d,'ROUTER_PROBE_PORT',probe),patch.object(d,'SLOTS',ports),patch.object(d.subprocess,'run',side_effect=command),patch.object(d,'prepare_slot',side_effect=lambda name,target:d.healthy(ports[name][0])),patch.object(d,'idle',return_value=True),patch.object(d,'restart_workers'):
            with patch.object(d,'idle',return_value=False):
                assert not d.activate(new,old,state);assert read()=='blue';phone_ping();assert not stopped
            assert d.activate_slots(new,old,state);assert read()=='green';assert not d.reap_slots();assert not stopped
            upload.send(b'upload!');response=upload.getresponse();assert response.status==200;assert response.read()==b'blue';upload.close();upload=None
            if router:
                for _ in range(100):
                    if d.reap_slots():break
                    time.sleep(.05)
                else:raise AssertionError('CRM requests did not drain while phone remained connected')
                phone_ping();assert 'sm-crm-web@blue' in stopped
                edge_upload.send(b'upload!');response=edge_upload.getresponse();assert response.status==200;assert response.read()==b'green';edge_upload.close();edge_upload=None
                request=urllib.request.Request('http://127.0.0.1:'+str(public)+'/headers',headers={'Host':'crm.test','Authorization':'Bearer synthetic','Cookie':'session=synthetic'})
                with urllib.request.urlopen(request,timeout=5) as response:
                    assert json.loads(response.read())=={'Host':'crm.test','X-Forwarded-Proto':'https','X-Forwarded-For':'127.0.0.1','X-Real-IP':'127.0.0.1','Authorization':'Bearer synthetic','Cookie':'session=synthetic'}
                request=urllib.request.Request('http://127.0.0.1:'+str(public)+'/large',data=b'x'*(2*1024*1024))
                with urllib.request.urlopen(request,timeout=10) as response:assert response.read()==b'green'
                third=base/'releases'/('gh-'+'c'*40)
                static=third/'.next/standalone/.next/static';static.mkdir(parents=True);(static/'c.js').write_text('c')
                (third/'release.json').write_text(json.dumps({'staticFiles':['c.js'],'legacySnapshots':1}))
                assert d.activate_slots(third,new,state);assert read()=='blue';phone_ping()
                assert d.activate_slots(new,third,state);assert read()=='green';phone_ping()
                assert pathlib.Path('/proc/'+edgepid.read_text().strip()+'/task/'+edgepid.read_text().strip()+'/children').read_text()==edge_workers,'public proxy workers were reloaded'
            else:
                assert not d.reap_slots(),'persistent upgraded connection must keep old slot alive'
                assert d.activate_slots(old,new,state);assert read()=='blue';assert not stopped
                assert d.activate_slots(new,old,state);assert read()=='green';assert not stopped
            release_ws.set();ws.close();ws=None
            for _ in range(100):
                if d.reap_slots():break
                time.sleep(.05)
            else:raise AssertionError('old workers did not drain')
            assert 'sm-crm-web@blue' in stopped;assert read()=='green'
            # Full application rollback keeps the candidate alive until Nginx drains it.
            assert d.activate_slots(old,new,state);assert read()=='blue'
        thread.join();assert not errors,errors
        with sqlite3.connect(dbfile) as db:
            rows=db.execute('select id,version from writes').fetchall()
        assert len(rows)==len(saved)+(3 if router else 1);assert len({r[0] for r in rows})==len(rows)
        assert ('long-upload!','blue') in rows
        if router:
            assert ('edge-upload!','green') in rows
            assert ('large-'+hashlib.sha256(b'x'*(2*1024*1024)).hexdigest(),'green') in rows
        print(json.dumps({'passed':True,'privateRouter':router,'successfulSaves':len(rows),'httpErrors':errors,'bufferedUploadPreserved':True,'upgradedConnectionPreserved':True,'rollback':True}))
    finally:
        stop.set();release_ws.set()
        if upload:upload.close()
        if edge_upload:edge_upload.close()
        if ws:ws.close()
        if pid.exists():os.kill(int(pid.read_text()),signal.SIGTERM)
        if edgepid.exists():os.kill(int(edgepid.read_text()),signal.SIGTERM)
        for server in servers:server.shutdown();server.server_close()

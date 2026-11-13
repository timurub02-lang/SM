"""Real Nginx reload, buffered POST, shared SQLite and a persistent upgraded connection.
Run on Linux with nginx installed; all listeners and data are isolated temporary fixtures.
"""
import concurrent.futures,http.client,http.server,importlib.util,json,os,pathlib,shutil,signal,socket,sqlite3,subprocess,tempfile,threading,time,urllib.request
from unittest.mock import patch
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy',root/'scripts/deploy-crm.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
assert shutil.which('nginx'),'nginx is required, never silently skip this acceptance test'
def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='crm-blue-green-') as folder:
    base=pathlib.Path(folder);os.chmod(base,0o755);dbfile=base/'synthetic.sqlite'
    with sqlite3.connect(dbfile) as db:db.execute('pragma journal_mode=WAL');db.execute('create table writes(id text primary key, version text)')
    ports={name:(port(),port()) for name in ['blue','green']};public=port();probe=port();errors=[];stop=threading.Event();upgraded=threading.Event();release_ws=threading.Event();saved=[]
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path=='/ws':
                self.send_response(101);self.send_header('Upgrade','fixture');self.send_header('Connection','upgrade');self.end_headers();upgraded.set();release_ws.wait(60);return
            body=b'<html><script src="/_next/static/test.js"></script></html>' if self.path=='/login' else self.server.version.encode()
            self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_POST(self):
            identifier=self.rfile.read(int(self.headers['Content-Length'])).decode()
            with sqlite3.connect(dbfile,timeout=5) as db:db.execute('insert into writes values(?,?)',(identifier,self.server.version))
            body=self.server.version.encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    servers=[]
    for name in ports:
        server=http.server.ThreadingHTTPServer(('127.0.0.1',ports[name][0]),Handler);server.daemon_threads=True;server.version=name;threading.Thread(target=server.serve_forever,daemon=True).start();servers.append(server)
    config=base/'nginx.conf';pid=base/'nginx.pid';upstream=base/'upstream.conf'
    upstream.write_text('upstream sm_crm_web { server 127.0.0.1:'+str(ports['blue'][0])+'; }\n')
    config.write_text('pid '+str(pid)+';\nerror_log '+str(base/'error.log')+';\nevents {}\nhttp { access_log off; client_body_temp_path '+str(base/'body')+'; proxy_temp_path '+str(base/'proxy')+'; include '+str(upstream)+'; server { listen 127.0.0.1:'+str(public)+'; location / { proxy_pass http://sm_crm_web; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; } } }\n')
    subprocess.run(['nginx','-p',folder,'-c',str(config)],check=True)
    old_run=subprocess.run
    stopped=[]
    def command(args,**kwargs):
        if args==['nginx','-t']:return old_run(['nginx','-t','-p',folder,'-c',str(config)],**kwargs)
        if args==['systemctl','reload','nginx']:os.kill(int(pid.read_text()),signal.SIGHUP);return subprocess.CompletedProcess(args,0)
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
    ws=None;upload=None
    try:
        for letter in ['a','b']:
            path=base/'releases'/('gh-'+letter*40);static=path/'.next/standalone/.next/static';static.mkdir(parents=True);(static/(letter+'.js')).write_text(letter)
            (path/'release.json').write_text(json.dumps({'staticFiles':[letter+'.js'],'legacySnapshots':1}))
        old=base/'releases'/('gh-'+'a'*40);new=base/'releases'/('gh-'+'b'*40);(base/'current').symlink_to(old)
        state={'current':old.name,'history':[old.name]};(base/'deploy-state.json').write_text(json.dumps(state));(base/'blue-green.json').write_text(json.dumps({'active':'blue','slots':{'blue':{'release':old.name}}}))
        ws=socket.create_connection(('127.0.0.1',public));ws.sendall(b'GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');assert b'101' in ws.recv(2048);assert upgraded.wait(2)
        # Body remains buffered in OLD Nginx, with no upstream TCP socket yet.
        upload=http.client.HTTPConnection('127.0.0.1',public,timeout=10);upload.putrequest('POST','/save');upload.putheader('Content-Length','12');upload.endheaders();upload.send(b'long-');time.sleep(.1)
        thread=threading.Thread(target=traffic);thread.start()
        with patch.object(d,'BASE',base),patch.object(d,'UPSTREAM',upstream),patch.object(d,'NGINX_PID',pid),patch.object(d,'PROBE_PORT',probe),patch.object(d,'SLOTS',ports),patch.object(d.subprocess,'run',side_effect=command),patch.object(d,'prepare_slot',side_effect=lambda name,target:d.healthy(ports[name][0])),patch.object(d,'idle',return_value=True),patch.object(d,'restart_workers'):
            assert d.activate_slots(new,old,state);assert read()=='green';assert not d.reap_slots();assert not stopped
            upload.send(b'upload!');response=upload.getresponse();assert response.status==200;assert response.read()==b'blue';upload.close();upload=None
            assert not d.reap_slots(),'persistent upgraded connection must keep old slot alive'
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
        assert len(rows)==len(saved)+1;assert len({r[0] for r in rows})==len(rows)
        assert ('long-upload!','blue') in rows
        print(json.dumps({'passed':True,'successfulSaves':len(rows),'httpErrors':errors,'bufferedUploadPreserved':True,'upgradedConnectionPreserved':True,'rollback':True}))
    finally:
        stop.set();release_ws.set()
        if upload:upload.close()
        if ws:ws.close()
        if pid.exists():os.kill(int(pid.read_text()),signal.SIGTERM)
        for server in servers:server.shutdown();server.server_close()

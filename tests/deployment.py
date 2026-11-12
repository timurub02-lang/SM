import importlib.util,io,json,pathlib,tarfile,tempfile,unittest
from unittest.mock import patch,MagicMock,call

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
root=pathlib.Path(__file__).resolve().parents[1]
deploy=module('deploy',root/'scripts/deploy-crm.py')
pack=module('pack',root/'scripts/package-crm.py')

class Deployment(unittest.TestCase):
    def test_phone_idle_checks_aggregate_and_fails_closed(self):
        for db_busy, payload, status, expected in [(0,{'busy':False},200,True),(0,{'busy':True},200,False),(1,{'busy':False},200,False),(0,{},200,None),(0,{'busy':'false'},200,None),(0,{'busy':False},503,None)]:
            with self.subTest(payload=payload,status=status), patch.object(deploy.sqlite3,'connect') as connect, patch.object(deploy.http.client.HTTPConnection,'request') as request, patch.object(deploy.http.client.HTTPConnection,'getresponse') as response:
                connect.return_value.__enter__.return_value.execute.return_value.fetchone.return_value=[db_busy]
                response.return_value.status=status;response.return_value.read.return_value=json.dumps(payload).encode()
                if expected is None:
                    with self.assertRaises(RuntimeError):deploy.idle()
                else:self.assertEqual(deploy.idle(),expected)
                request.assert_called_once_with('GET','/deployment-state')

    def test_package_and_identity(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);runtime=p/'.next/standalone';runtime.mkdir(parents=True)
            (runtime/'server.js').write_text('fixture');(runtime/'.env').write_text('must not leave host')
            (p/'public').mkdir();(p/'.next/static').mkdir()
            pack.package('a'*40,p);deploy.extract(p/'dist/crm-runtime.tgz',p/'unpack')
            self.assertFalse((p/'unpack/runtime/.env').exists())
            self.assertEqual(json.loads((p/'unpack/runtime/release.json').read_text())['commit'],'a'*40)
    def test_maintenance_uses_production_node(self):
        unit=(root/'scripts/systemd/sm-crm-maintenance.service').read_text()
        sync=(root/'scripts/systemd/sm-crm-sk-orders.service').read_text()
        runtime=next(line.split('=',1)[1].split()[0] for line in sync.splitlines() if line.startswith('ExecStart='))
        self.assertIn('ExecStart='+runtime+' /srv/crm/current/scripts/sync-maintenance.mjs',unit)
        self.assertIn('ConditionPathExists=/srv/crm/current/scripts/sync-maintenance.mjs',unit)

    def test_maintenance_job_and_legacy_releases(self):
        with tempfile.TemporaryDirectory() as folder:
            path=pathlib.Path(folder)
            for name in ['activity','base','cdek-deletions','cdek-shipments','lv-warehouse','redemption','sk-orders']:(path/('sync-'+name+'.mjs')).write_text('fixture')
            deploy.validate_jobs(path,{'format':1})
            with self.assertRaises(ValueError):deploy.validate_jobs(path,{'maintenance':1})
            (path/'sync-maintenance.mjs').write_text('fixture')
            deploy.validate_jobs(path,{'maintenance':1})
            with self.assertRaises(ValueError):deploy.validate_jobs(path,{'maintenance':1,'exports':1})
            (path/'sync-exports.mjs').write_text('fixture')
            deploy.validate_jobs(path,{'maintenance':1,'exports':1})
            with self.assertRaises(ValueError):deploy.validate_jobs(path,{'maintenance':1,'exports':1,'summaries':1})
            (path/'sync-summaries.mjs').write_text('fixture')
            deploy.validate_jobs(path,{'maintenance':1,'exports':1,'summaries':1})
            for marker,job in [('skEvents','sk-events'),('lvIncoming','lv-incoming')]:
                meta={'maintenance':1,'exports':1,'summaries':1,marker:1}
                with self.assertRaises(ValueError):deploy.validate_jobs(path,meta)
                (path/('sync-'+job+'.mjs')).write_text('fixture');deploy.validate_jobs(path,meta)
                (path/('sync-'+job+'.mjs')).unlink()
            for job in ['sk-events','lv-incoming']:(path/('sync-'+job+'.mjs')).write_text('fixture')
            deploy.validate_jobs(path,{'maintenance':1,'exports':1,'summaries':1,'skEvents':1,'lvIncoming':1})
            for job in ['sk-events','lv-incoming']:(path/('sync-'+job+'.mjs')).unlink()
            with self.assertRaises(ValueError):deploy.validate_jobs(path,{'maintenance':1,'exports':1})
            (path/'sync-summaries.mjs').unlink()
            (path/'sync-exports.mjs').unlink()
            (path/'sync-base.mjs').unlink()
            with self.assertRaises(ValueError):deploy.validate_jobs(path,{'maintenance':1})

    def test_summary_service_is_bounded_and_opt_in(self):
        unit=(root/'scripts/systemd/sm-crm-summaries.service').read_text()
        for value in ['Type=simple','ConditionPathExists=/srv/crm/current/scripts/sync-summaries.mjs','ExecStart=/opt/sm-node/bin/node --max-old-space-size=512 /srv/crm/current/scripts/sync-summaries.mjs','MemoryMax=768M','CPUQuota=100%','Restart=on-failure','Environment=CRM_SUMMARIES_WORKER=1']:
            self.assertIn(value,unit)
        self.assertFalse((root/'scripts/systemd/sm-crm-summaries.timer').exists(),'the daemon owns its cadence; no second timer')

    def test_switch_restarts_only_an_active_summary_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            deploy.BASE=pathlib.Path(folder);target=deploy.BASE/'new';target.mkdir()
            for active in [0,3,4]:
                with self.subTest(active=active),patch.object(deploy,'healthy'),patch.object(deploy.subprocess,'run') as run:
                    run.return_value.returncode=active
                    deploy.switch(target)
                    expected=[call(['systemctl','restart','sm-crm'],check=True)]
                    for service in ['sm-crm-summaries','sm-crm-sk-events']:
                        expected.append(call(['systemctl','is-active','--quiet',service],check=False))
                        if active==0:expected.append(call(['systemctl','try-restart',service],check=True))
                    self.assertEqual(run.call_args_list,expected)

    def test_failed_web_health_does_not_restart_summary_worker(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(deploy,'BASE',pathlib.Path(folder)):
            target=deploy.BASE/'new';target.mkdir()
            with patch.object(deploy,'healthy',side_effect=RuntimeError('unhealthy')),patch.object(deploy.subprocess,'run') as run:
                with self.assertRaisesRegex(RuntimeError,'unhealthy'):deploy.switch(target)
                run.assert_called_once_with(['systemctl','restart','sm-crm'],check=True)

    def test_summary_manifest_marker(self):
        with tempfile.TemporaryDirectory() as folder:
            p=pathlib.Path(folder);runtime=p/'.next/standalone';runtime.mkdir(parents=True)
            (runtime/'server.js').write_text('fixture');(p/'public').mkdir();(p/'.next/static').mkdir();(p/'scripts').mkdir();(runtime/'jobs').mkdir()
            (p/'scripts/sync-summaries.mjs').write_text('fixture');(runtime/'jobs/sync-summaries.mjs').write_text('fixture')
            with patch.object(pack.subprocess,'run',return_value=type('Probe',(),{'returncode':1,'stderr':'CRM_DATABASE_PATH is required'})()):pack.package('b'*40,p)
            self.assertEqual(json.loads((runtime/'release.json').read_text())['summaries'],1)

    def test_ingress_workers_remain_independent(self):
        sync=(root/'scripts/sync-sk-orders.mjs').read_text()
        self.assertNotIn('syncLvIncoming',sync)
        self.assertIn('syncLvIncoming',(root/'scripts/sync-lv-incoming.mjs').read_text())
        unit=(root/'scripts/systemd/sm-crm-sk-events.service').read_text()
        for value in ['Type=simple','ConditionPathExists=/srv/crm/current/scripts/sync-sk-events.mjs','MemoryMax=384M','Restart=on-failure']:
            self.assertIn(value,unit)
        self.assertIn('OnUnitActiveSec=60s',(root/'scripts/systemd/sm-crm-sk-orders.timer').read_text())
        self.assertIn('OnUnitActiveSec=60s',(root/'scripts/systemd/sm-crm-lv-incoming.timer').read_text())

    def test_ingress_manifest_and_isolated_probe(self):
        with tempfile.TemporaryDirectory() as folder:
            p=pathlib.Path(folder);runtime=p/'.next/standalone';runtime.mkdir(parents=True)
            (runtime/'server.js').write_text('fixture');(p/'public').mkdir();(p/'.next/static').mkdir();(p/'scripts').mkdir();(runtime/'jobs').mkdir()
            for job in ['exports','sk-events','lv-incoming']:
                (p/('scripts/sync-'+job+'.mjs')).write_text('fixture');(runtime/('jobs/sync-'+job+'.mjs')).write_text('fixture')
            def probe(args,**kwargs):return type('Probe',(),{'returncode':0 if '--input-type=module' in args else 1,'stderr':'CRM_DATABASE_PATH is required'})()
            with patch.object(pack.subprocess,'run',side_effect=probe) as run:
                pack.package('c'*40,p)
            meta=json.loads((runtime/'release.json').read_text());self.assertEqual((meta['exports'],meta['skEvents'],meta['lvIncoming']),(1,1,1))
            self.assertTrue(any('trace-job-dependencies.mjs' in str(c.args[0]) for c in run.call_args_list))
            probes=[c for c in run.call_args_list if 'cwd' in c.kwargs];self.assertEqual(len(probes),4)
            for probe in probes:
                self.assertFalse(probe.kwargs['cwd'].is_relative_to(p));self.assertNotIn('CRM_DATABASE_PATH',probe.kwargs['env']);self.assertNotIn('NODE_PATH',probe.kwargs['env'])
                if '--input-type=module' not in probe.args[0]:self.assertEqual(pathlib.Path(probe.args[0][1]).parent.name,'scripts')

    def test_installer_creates_only_internal_dependency_alias(self):
        with tempfile.TemporaryDirectory() as folder:
            staged=pathlib.Path(folder);dependencies=staged/'.next/standalone/node_modules';dependencies.mkdir(parents=True)
            with patch.object(pathlib.Path,'symlink_to',autospec=True) as link:
                deploy.link_job_dependencies(staged)
                link.assert_called_once_with(staged/'node_modules','.next/standalone/node_modules',target_is_directory=True)
            dependencies.rmdir()
            with self.assertRaises(ValueError):deploy.link_job_dependencies(staged)

    @unittest.skipIf(__import__('os').name=='nt','Windows account cannot create symlinks; Linux CI exercises the real alias')
    def test_installed_scripts_resolve_internal_dependencies(self):
        with tempfile.TemporaryDirectory() as folder:
            staged=pathlib.Path(folder);package=staged/'.next/standalone/node_modules/fixture-dependency';package.mkdir(parents=True)
            (package/'package.json').write_text('{"name":"fixture-dependency","main":"index.js"}');(package/'index.js').write_text('module.exports=42')
            (staged/'scripts').mkdir();script=staged/'scripts/probe.mjs';script.write_text("import value from 'fixture-dependency';if(value!==42)throw Error('Wrong dependency');")
            deploy.link_job_dependencies(staged)
            self.assertEqual((staged/'node_modules').readlink(),pathlib.Path('.next/standalone/node_modules'))
            self.assertEqual((staged/'node_modules').resolve(),(staged/'.next/standalone/node_modules').resolve())
            deploy.subprocess.run(['node',str(script)],cwd=staged,check=True,capture_output=True)

    def test_reject_traversal_and_links(self):
        for name,kind in [('runtime/../../escape',tarfile.REGTYPE),('/escape',tarfile.REGTYPE),('runtime/link',tarfile.SYMTYPE),('runtime/.env',tarfile.REGTYPE)]:
            with tempfile.TemporaryDirectory() as d:
                archive=pathlib.Path(d)/'bad.tgz'
                with tarfile.open(archive,'w:gz') as tar:
                    item=tarfile.TarInfo(name);item.type=kind;item.linkname='/etc/passwd';tar.addfile(item,io.BytesIO())
                with self.assertRaises(ValueError):deploy.extract(archive,pathlib.Path(d)/'out')
    def test_retention_keeps_current_and_two_and_ignores_unmanaged(self):
        with tempfile.TemporaryDirectory() as d:
            deploy.BASE=pathlib.Path(d);releases=deploy.BASE/'releases';releases.mkdir()
            names=['gh-'+c*40 for c in 'abcd']
            for name in names+['someone-working']:
                p=releases/name;p.mkdir();(p/'release.json').write_text('{}')
            self.assertEqual(deploy.retain(names,releases/names[0]),names[:3])
            self.assertFalse((releases/names[3]).exists());self.assertTrue((releases/'someone-working').exists())
    def test_failed_health_restores_previous_release(self):
        with tempfile.TemporaryDirectory() as d:
            deploy.BASE=pathlib.Path(d);previous=deploy.BASE/'saved';target=deploy.BASE/'new';state={'history':['saved']}
            with patch.object(deploy,'current',return_value=previous),patch.object(deploy,'idle',return_value=True),patch.object(deploy.sqlite3,'connect',return_value=MagicMock()),patch.object(deploy.os,'chmod'),patch.object(deploy.os,'replace'),patch.object(deploy,'switch',side_effect=[RuntimeError('health failure'),None]) as switch:
                with self.assertRaisesRegex(RuntimeError,'health failure'):deploy.activate(target,previous,state)
                self.assertEqual(switch.call_args_list,[call(target),call(previous)])
                self.assertEqual(state,{'history':['saved']})

    def test_github_auth_is_scoped_and_asset_api_used(self):
        with patch.object(deploy,'github_token',return_value='synthetic-token') as token,patch.object(deploy.urllib.request,'build_opener') as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value=b'fixture'
            deploy.get(deploy.API+'/releases/latest')
            req=opener.return_value.open.call_args.args[0]
            self.assertEqual(req.get_header('Authorization'),'Bearer synthetic-token')
            deploy.get('http://127.0.0.1:3000/login')
            self.assertIsNone(opener.return_value.open.call_args.args[0].get_header('Authorization'))
            deploy.get('https://api.github.com.evil.test/repos/'+deploy.REPO)
            self.assertIsNone(opener.return_value.open.call_args.args[0].get_header('Authorization'))
            self.assertEqual(token.call_count,1)
            deploy.release_asset({'id':123,'browser_download_url':'https://evil.test'},100)
            req=opener.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url,deploy.API+'/releases/assets/123')
            self.assertEqual(req.get_header('Accept'),'application/octet-stream')
        for value in [True,0,-1,'123',None]:
            with self.assertRaises(ValueError):deploy.release_asset({'id':value},100)

    def test_redirect_drops_token_and_rejects_downgrade(self):
        req=deploy.urllib.request.Request(deploy.API+'/releases/assets/123',headers={'Authorization':'Bearer synthetic-token','Accept':'application/octet-stream'})
        handler=deploy.SafeRedirect()
        for url in ['https://release-assets.githubusercontent.com/fixture?signed=value',deploy.API+'/other']:
            redirected=handler.redirect_request(req,None,302,'Found',{},url)
            self.assertIsNone(redirected.get_header('Authorization'))
            self.assertEqual(redirected.get_header('Accept'),'application/octet-stream')
        for url in ['http://example.test/file','file:///etc/passwd','https://user:password@example.test/file']:
            with self.assertRaises(ValueError):handler.redirect_request(req,None,302,'Found',{},url)

    def test_credentials_opt_in_permissions_and_redaction(self):
        with patch.dict(deploy.os.environ,{},clear=True):
            self.assertIsNone(deploy.github_token())
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'token';path.write_text('synthetic_token_1234567890\n');path.chmod(0o600)
            with patch.dict(deploy.os.environ,{'SM_CRM_GITHUB_TOKEN_FILE':str(path)}):
                info=path.stat()
                with patch.object(deploy.os,'fstat',return_value=type('Info',(),{'st_mode':info.st_mode,'st_uid':0})()):
                    self.assertEqual(deploy.github_token(),'synthetic_token_1234567890')
                for mode,uid in [(0o100644,0),(0o100700,0),(0o104600,0),(0o100600,1000),(0o010600,0)]:
                    with patch.object(deploy.os,'fstat',return_value=type('Info',(),{'st_mode':mode,'st_uid':uid})()):
                        with self.assertRaisesRegex(RuntimeError,'Cannot load GitHub credential'):deploy.github_token()
                path.unlink()
                with self.assertRaisesRegex(RuntimeError,'Cannot load GitHub credential'):deploy.github_token()
                path.write_text('synthetic_token_1234567890');path.chmod(0o600)
                link=pathlib.Path(directory)/'link';link.symlink_to(path)
                with patch.dict(deploy.os.environ,{'SM_CRM_GITHUB_TOKEN_FILE':str(link)}):
                    with self.assertRaisesRegex(RuntimeError,'Cannot load GitHub credential'):deploy.github_token()
                for value in ['', 'short', 'synthetic_token_1234567890\nsecond_line', 'a'*4097]:
                    path.write_text(value)
                    with self.assertRaisesRegex(RuntimeError,'Cannot load GitHub credential'):deploy.github_token()

    def test_download_errors_hide_signed_urls_and_respect_size(self):
        with patch.object(deploy,'github_token',return_value=None),patch.object(deploy.urllib.request,'build_opener') as opener:
            for failure in [deploy.urllib.error.HTTPError('https://cdn.test/?secret=value',403,'secret-value',{},None),RuntimeError('secret-value')]:
                opener.return_value.open.side_effect=failure
                with self.assertRaises(RuntimeError) as caught:deploy.get(deploy.API+'/releases/latest')
                self.assertNotIn('secret',str(caught.exception))
                self.assertTrue(caught.exception.__suppress_context__)
            opener.return_value.open.side_effect=None
            opener.return_value.open.return_value.__enter__.return_value.read.return_value=b'1234'
            with self.assertRaisesRegex(ValueError,'Download too large'):deploy.get(deploy.API+'/releases/latest',3)

if __name__=='__main__':unittest.main()

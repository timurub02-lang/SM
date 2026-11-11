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

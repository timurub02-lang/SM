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

if __name__=='__main__':unittest.main()

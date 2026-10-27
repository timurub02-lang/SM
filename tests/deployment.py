import importlib.util,io,json,pathlib,tarfile,tempfile,unittest

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
root=pathlib.Path(__file__).resolve().parents[1]
deploy=module('deploy',root/'scripts/deploy-crm.py')
pack=module('pack',root/'scripts/package-crm.py')

class Deployment(unittest.TestCase):
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

if __name__=='__main__':unittest.main()

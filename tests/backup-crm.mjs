import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const code=`import importlib.util,pathlib,tempfile,sqlite3,datetime
s=importlib.util.spec_from_file_location('backup','scripts/backup-crm.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 root=pathlib.Path(tmp);m.ROOT=root/'backups';source=root/'source.sqlite';d=sqlite3.connect(source);d.execute('CREATE TABLE fixture(value)');d.execute("INSERT INTO fixture VALUES('safe')");d.commit();d.close();m.SOURCES={'crm':source,'pilot':source}
 m.ROOT.mkdir();old=m.ROOT/'2000-01-01-crm.sqlite';old.write_text('obsolete');unrelated=m.ROOT/'manual.sqlite';unrelated.write_text('keep');m.backup();assert not old.exists() and unrelated.read_text()=='keep'
 today=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
 for name in m.SOURCES:
  with sqlite3.connect(m.ROOT/(today+'-'+name+'.sqlite')) as d:assert d.execute('SELECT value FROM fixture').fetchone()[0]=='safe'
 old.write_text('keep on failure');m.SOURCES['pilot']=root/'missing'
 try:m.backup();assert False
 except sqlite3.OperationalError:pass
 assert old.exists() and not list(m.ROOT.glob('*.tmp'))
`;
const result=spawnSync(process.platform==='win32'?'python':'python3',['-c',code],{encoding:'utf8'});
assert.equal(result.status,0,result.stdout+result.stderr);console.log('Verified backup contents, scoped retention and preservation on failure');

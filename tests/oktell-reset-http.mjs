import http from 'node:http';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';

const dir=mkdtempSync(join(tmpdir(),'oktell-reset-')),file=join(dir,'test.sqlite');
const db=new DatabaseSync(file),origin='https://crm.test',base='http://127.0.0.1:3326';
const sock=join(dir,'bridge.sock');let server,logs='',bridgeRequests=0;
const bridge=http.createServer((req,res)=>{bridgeRequests++;res.writeHead(503).end();});
await new Promise(r=>bridge.listen(sock,r));
async function boot(){
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',OKTELL_CONTROL_SOCKET:sock,CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3326'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,100));}
 throw Error('Server not ready');
}
async function stop(){if(server&&server.exitCode===null){server.kill();await once(server,'exit');}}
async function call(path,cookie,body){
 const r=await fetch(base+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,headers:r.headers,text:await r.text()};
}
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword('synthetic-reset-only-2026');
 for(const [id,role] of [['admin','admin'],['head','department_head'],['operator','operator'],['tester','operator']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:'Тестовый сотрудник',alias:'',skLogin:'',role,department:'1',salary:0,bonus:0}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare('INSERT INTO auth_test_accounts VALUES(?)').run('tester');
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 await boot();
 const anonymous=await call('/oktell');assert.equal(anonymous.status,307);assert.equal(anonymous.headers.get('location'),'/login');
 const cookies={};
 for(const id of ['admin','head','operator','tester']){
  const r=await call('/api/auth/login',null,{login:id,password:'synthetic-reset-only-2026'});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];
 }
 for(const id of ['tester']){
  const r=await call('/oktell',cookies[id]);assert.equal(r.status,200);assert.match(r.text,/Раздел пока пуст/);assert.doesNotMatch(r.text,/CRM NO CALLS|Имитировать соединение|Учебная линия/);
  assert.match(r.headers.get('permissions-policy'),/microphone=\(\)/);
 }
 for(const id of ['operator','admin','head']){const r=await call('/oktell',cookies[id]);assert.equal(r.status,307);assert.equal(r.headers.get('location'),id==='operator'?'/?calls':'/');}
 for(const route of ['/oktell-demo','/oktell-projects','/oktell-test']){
  const r=await call(route,cookies.admin);assert.equal(r.status,307);assert.equal(r.headers.get('location'),'/oktell');
 }
 for(const cookie of [undefined,...Object.values(cookies)])for(const route of ['/api/oktell-projects','/api/oktell-test-task']){
  assert.equal((await call(route,cookie)).status,410);
  assert.equal((await call(route,cookie,{action:'activate',revision:'a'.repeat(64)})).status,410);
 }
 for(const route of ['/api/crm','/api/base','/api/warehouse','/api/cash','/api/telephony/pbx'])assert.ok([401,403].includes((await call(route,cookies.tester)).status),route);
 db.prepare("UPDATE employees SET data=json_set(data,'$.role','admin') WHERE id='tester'").run();
 assert.equal((await call('/api/crm',cookies.tester)).status,401);
 await stop();await boot();assert.equal((await call('/api/crm',cookies.tester)).status,401);assert.equal((await call('/oktell',cookies.tester)).status,200);
 db.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='tester'").run();assert.equal((await call('/oktell',cookies.tester)).status,307);
 assert.equal(bridgeRequests,0);assert.equal(db.prepare('SELECT count(*) n FROM clients').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='oktell_pilot_state'").get().n,0);
 console.log('PASS: empty page, access restrictions, legacy redirects, retired commands, test-account boundary, restart/revocation, no bridge requests or pilot state');
}catch(e){console.error(logs);throw e;}finally{await stop();await new Promise(r=>bridge.close(r));db.close();rmSync(dir,{recursive:true,force:true});}

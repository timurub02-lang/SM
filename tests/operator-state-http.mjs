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
const sock=join(dir,'bridge.sock');let server,logs='',bridgeRequests=0,lastBody; const actor='E-43a21d76-351';
const bridge=http.createServer((req,res)=>{bridgeRequests++;let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{lastBody=raw?JSON.parse(raw):null;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:'break',checkedAt:new Date().toISOString()}));});});
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
 for(const [id,role] of [['admin','admin'],['head','department_head'],['operator','operator'],['tester','operator'],[actor,'operator']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id===actor?'SKP_Solomatina.Irina':id,name:'Тестовый сотрудник',alias:'',skLogin:'',role,department:'1',salary:0,bonus:0}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare('INSERT INTO auth_test_accounts VALUES(?)').run('tester');
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 await boot();
 const cookies={};
 for(const id of ['admin','head','operator','tester',actor]){
  const r=await call('/api/auth/login',null,{login:id===actor?'SKP_Solomatina.Irina':id,password:'synthetic-reset-only-2026'});assert.equal(r.status,200);cookies[id]=r.headers.get('set-cookie').split(';')[0];
 }
 assert.equal((await call('/oktell-pilot')).status,307);
 assert.equal((await call('/oktell-pilot',cookies.admin)).status,200);
 for(const who of ['head','operator','tester',actor])assert.equal((await call('/oktell-pilot',cookies[who])).status,307,'Pilot contact list is administrator-only');
 assert.equal((await call('/api/operator-state')).status,401);
 for(const id of ['admin','head','operator','tester'])for(const body of [undefined,{action:'ready'}])assert.ok([401,403].includes((await call('/api/operator-state',cookies[id],body)).status));
 assert.equal(bridgeRequests,0);
 assert.equal((await call('/api/operator-state',cookies[actor])).status,200);
 assert.equal((await call('/api/operator-state',cookies[actor],{action:'break',reason:'Обед'})).status,200);
 assert.deepEqual(lastBody,{actor,action:'break',reason:'Обед'});
 db.prepare("UPDATE employees SET data=json_set(data,'$.login',?) WHERE id=?").run('SKP_Ira.Salomatina_5.19',actor);
 assert.equal((await call('/api/operator-state',cookies[actor])).status,200,'Stable employee ID survives CRM login changes');
 const count=bridgeRequests;
 assert.equal((await call('/api/operator-state',cookies[actor],{action:'ready',actorId:'operator'})).status,403);
 assert.equal((await call('/api/operator-state',cookies[actor],{action:'fake'})).status,400);
 assert.equal(bridgeRequests,count);
 const csrf=await fetch(base+'/api/operator-state',{method:'POST',headers:{cookie:cookies[actor],'Content-Type':'application/json',Origin:'https://other.invalid'},body:JSON.stringify({action:'ready'})});assert.equal(csrf.status,403);
 db.prepare('UPDATE auth_accounts SET enabled=0 WHERE employee_id=?').run(actor);
 assert.equal((await call('/api/operator-state',cookies[actor],{action:'ready'})).status,401);
 assert.equal(bridgeRequests,count);
 console.log('PASS: operator-state authentication, exact employee binding, CSRF, revocation, no delegation or test-account access');
}catch(e){console.error(logs);throw e;}finally{await stop();await new Promise(r=>bridge.close(r));db.close();rmSync(dir,{recursive:true,force:true});}

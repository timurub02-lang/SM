// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-auth-')), db=new DatabaseSync(join(dir,'test.sqlite'));
const password='test-password-only-123',changed='changed-password-only-456';
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3097',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[['admin','admin','1'],['one','operator','1'],['two','operator','2'],['head','department_head','1']].map(([id,role,department])=>({id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department,salary:100,bonus:1,version:1}));
 for(const e of staff){db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,hash);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 for(const id of ['one','two']){
  const c={id:'c-'+id,name:'Client '+id,phone:id==='one'?'+79990000001':'+79990000002',city:'',address:'',source:'Test',owner:id,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version:1};
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+id,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,{cookie,body,headers={},method}={}){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,headers:r.headers,text};}
 async function login(name,pw=password){return call('/api/auth/login',{body:{login:name,password:pw}});}
 const unauth=await call('/api/crm',{headers:{'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'admin@test.local'}});assert.equal(unauth.status,401);
 assert.equal((await call('/')).status,307);
 assert.equal((await login('admin','wrong-password')).status,401);
 const cookies={};for(const id of ['admin','one','two','head']){const r=await login(id);assert.equal(r.status,200,r.text);const c=r.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=strict'])assert.ok(c.toLowerCase().includes(flag.toLowerCase()),flag);cookies[id]=c.split(';')[0];}
 for(let i=0;i<3;i++){const r=await call('/api/auth/me',{cookie:cookies.admin});assert.equal(r.data.employee.role,'admin');}
 for(const id of ['one','head']){const r=await call('/api/crm',{cookie:cookies[id]});assert.equal(r.status,200,r.text);assert.equal(r.data.currentEmployeeId,id);assert.deepEqual(r.data.orders.map(o=>o.id),['o-one']);assert.deepEqual(r.data.clients.map(c=>c.id),['c-one']);assert.equal(r.data.clients[0].phone,'');assert.ok(!r.text.includes('password_hash'));}
 assert.equal((await call('/api/crm',{cookie:cookies.one,body:{actorId:'admin',action:'settings',retentionDays:2}})).status,403);
 assert.equal((await call('/api/crm',{cookie:cookies.one,body:{action:'updateClient',id:'c-two'}})).status,400);
 assert.equal((await call('/api/crm',{cookie:cookies.admin,body:{action:'settings',retentionDays:2},headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await call('/api/crm',{cookie:cookies.admin,body:{action:'settings',retentionDays:2},headers:{Origin:''}})).status,403);
 assert.equal((await call('/api/warehouse',{cookie:cookies.one})).status,403);
 assert.equal((await call('/api/skorozvon',{cookie:cookies.one})).status,403);
 assert.equal((await call('/api/skorozvon',{cookie:cookies.head,body:{revision:''}})).status,403);
 assert.equal((await call('/api/skorozvon',{cookie:cookies.admin})).data.configured,false);
 assert.equal((await call('/api/skorozvon',{cookie:cookies.admin,body:{revision:''}})).status,400);
 db.prepare('INSERT INTO settings VALUES(?,?)').run('skorozvon',JSON.stringify({login:'test@example.invalid',apiKey:'private-api-key',clientId:'private-client-id',clientSecret:'private-secret',checkedAt:new Date().toISOString(),revision:'test'}));
 const sk=await call('/api/skorozvon',{cookie:cookies.admin});assert.equal(sk.status,200);assert.equal(sk.data.configured,true);assert.equal(sk.data.syncEnabled,false);assert.ok(!sk.text.includes('private-'));
 assert.equal((await call('/api/skorozvon',{cookie:cookies.admin,body:{revision:'stale'}})).status,409);

 assert.equal((await call('/api/cdek',{cookie:cookies.one,body:{action:'save'}})).status,403);
 assert.equal((await call('/api/mainsms',{cookie:cookies.one,body:{action:'preview',orderId:'o-two'}})).status,403);
 async function save(actor,e,patch={},id=e.id){return call('/api/crm',{cookie:cookies[actor],body:{action:'saveEmployee',...(id?{id,version:e.version}:{}),employee:{...e,accessEnabled:true,...patch}}});}
 assert.equal((await save('head',staff[2],{password:changed})).status,400);
 assert.equal((await save('head',staff[0],{password:changed})).status,400);
 const fresh={...staff[1],id:undefined,login:'new-member',name:'New member'};
 assert.equal((await save('admin',fresh,{},null)).status,400);
 let r=await save('head',fresh,{role:'admin',department:'2',password},null);assert.equal(r.status,200,r.text);let member=r.data.state.employees.find(e=>e.login==='new-member');assert.equal(member.role,'operator');assert.equal(member.department,'1');
 const first=await login('new-member');assert.equal(first.status,200);const old=first.headers.get('set-cookie').split(';')[0];
 r=await save('admin',member,{password:changed});assert.equal(r.status,200,r.text);member=r.data.state.employees.find(e=>e.id===member.id);
 assert.equal((await call('/api/auth/me',{cookie:old})).status,401);assert.equal((await login('new-member')).status,401);
 let newLogin=await login('new-member',changed);assert.equal(newLogin.status,200);let current=newLogin.headers.get('set-cookie').split(';')[0];
 r=await save('admin',member,{department:'2'});assert.equal(r.status,200,r.text);member=r.data.state.employees.find(e=>e.id===member.id);assert.equal((await call('/api/auth/me',{cookie:current})).status,401);
 newLogin=await login('new-member',changed);current=newLogin.headers.get('set-cookie').split(';')[0];
 r=await save('admin',member,{accessEnabled:false});assert.equal(r.status,200,r.text);assert.equal((await call('/api/auth/me',{cookie:current})).status,401);assert.equal((await login('new-member',changed)).status,401);
 assert.equal((await save('admin',staff[0],{accessEnabled:false})).status,400);
 assert.equal((await call('/api/auth/logout',{cookie:cookies.one,body:{}})).status,200);assert.equal((await call('/api/auth/me',{cookie:cookies.one})).status,401);
 for(let i=0;i<10;i++)assert.equal((await login('missing')).status,401);assert.equal((await login('missing')).status,429);
 for(const row of db.prepare('SELECT data FROM employees').all()){assert.ok(!row.data.includes('password'));}
 // Assign an existing free client through its card: deadline starts once, not on every edit.
 const trialClient={id:'trial-card',name:'Trial client',phone:'+79990000099',owner:'',source:'Manual',city:'',address:'',createdAt:new Date().toISOString(),version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(trialClient.id,trialClient.phone,JSON.stringify(trialClient));
 let assigned=await call('/api/crm',{cookie:cookies.admin,body:{action:'updateClient',id:trialClient.id,version:1,client:{...trialClient,owner:'one'}}});assert.equal(assigned.status,200,assigned.text);
 let assignedClient=assigned.data.state.clients.find(c=>c.id===trialClient.id);assert.equal(assignedClient.sheet,'К');assert.ok(Math.abs(Date.parse(assignedClient.trialUntil)-Date.now()-86400000)<10000);
 const deadline=assignedClient.trialUntil;
 assigned=await call('/api/crm',{cookie:cookies.admin,body:{action:'updateClient',id:trialClient.id,version:assignedClient.version,client:{...assignedClient,name:'Edited client'}}});assert.equal(assigned.status,200,assigned.text);assert.equal(assigned.data.state.clients.find(c=>c.id===trialClient.id).trialUntil,deadline);
 // Employee deletion: exercise the real API and transaction against every order status.
 const statuses=['draft','confirm','rework','check','extra','packing','phone','shipping','pickup','redeemed','refused','returned'];
 async function fixture(id,department='1',role='operator'){
  const e={...staff[1],id,login:id,department,role};db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
  const loginResult=await login(id);assert.equal(loginResult.status,200);return {e,cookie:loginResult.headers.get('set-cookie').split(';')[0]};
 }
 function records(id){
  for(const [i,status] of [...statuses,'none'].entries()){
   const c={id:id+'-c-'+status,name:'Client',phone:'+7'+String(8000000000+db.prepare('SELECT COUNT(*) AS n FROM clients').get().n),city:'',address:'',source:'test.xlsx · Т3',sheet:'К',returnSheet:'Т3',trialReturnSheet:'Т1',owner:id,createdAt:new Date().toISOString(),version:1};db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
   if(status==='none')continue;
   const o={id:id+'-o-'+status,clientId:c.id,manager:id,logistic:'',status,items:[],comment:'Original comment',reason:'',contact:'none',due:'',round:1,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,redeemedAt:c.createdAt,...(status==='rework'?{reworkDeadline:new Date(Date.now()+86400000).toISOString()}:{}),version:1};db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
  }
 }
 async function remove(actor,e,mode,targetId,version=e.version){return call('/api/crm',{cookie:cookies[actor],body:{action:'deleteEmployee',id:e.id,version,mode,targetId}});}
 const transfer=await fixture('transfer');records('transfer');
 assert.equal((await remove('head',staff[2],'release')).status,400);
 assert.equal((await remove('head',staff[0],'release')).status,400);
 assert.equal((await remove('admin',staff[0],'release')).status,400);
 assert.equal((await remove('head',transfer.e,'transfer','two')).status,400);
 assert.equal((await remove('head',transfer.e,'transfer','one',99)).status,400);
 assert.ok(db.prepare('SELECT id FROM employees WHERE id=?').get('transfer'));
 let deleted=await remove('head',transfer.e,'transfer','one');assert.equal(deleted.status,200,deleted.text);
 assert.equal((await call('/api/auth/me',{cookie:transfer.cookie})).status,401);
 assert.equal((await login('transfer')).status,401);
 for(const row of db.prepare("SELECT data FROM orders WHERE id LIKE 'transfer-o-%'").all()){const o=JSON.parse(row.data);assert.equal(o.manager,'one');assert.equal(o.status,o.id.replace('transfer-o-',''));assert.equal(o.comment,'Original comment');}
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM clients WHERE id LIKE 'transfer-c-%' AND json_extract(data,'$.owner')='one'").get().n,11); // Refused/returned-only clients were already freed by normal retention before deletion.
 assert.equal((await remove('head',transfer.e,'transfer','one')).status,400);
 const release=await fixture('release');records('release');
 deleted=await remove('admin',release.e,'release');assert.equal(deleted.status,200,deleted.text);
 const live=['draft','confirm','rework','check','extra','packing','phone','shipping','pickup'];
 for(const row of db.prepare("SELECT data FROM clients WHERE id LIKE 'release-c-%'").all()){const c=JSON.parse(row.data),status=c.id.replace('release-c-','');assert.equal(c.owner,'');assert.equal(c.sheet,live.includes(status)?'К':status==='redeemed'?'ТК':'Т3');}
 for(const row of db.prepare("SELECT data FROM orders WHERE id LIKE 'release-o-%'").all()){const o=JSON.parse(row.data);assert.equal(o.manager,'');assert.equal(o.status,o.id.replace('release-o-',''));}
 assert.equal((await call('/api/auth/me',{cookie:release.cookie})).status,401);
 assert.ok(db.prepare("SELECT data FROM settings WHERE id='deleted-employee-release'").get());
 assert.ok(db.prepare("SELECT data FROM events WHERE client_id='release-c-shipping'").get());
 // The guard must roll back all writes if any statement fails, including access revocation.
 const rollback=await fixture('rollback');records('rollback');
 db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON employees WHEN OLD.id='rollback' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
 assert.equal((await remove('admin',rollback.e,'release')).status,400);
 assert.ok(db.prepare("SELECT id FROM employees WHERE id='rollback'").get());
 assert.equal(db.prepare("SELECT json_extract(data,'$.owner') AS owner FROM clients WHERE id='rollback-c-shipping'").get().owner,'rollback');
 assert.ok(!db.prepare("SELECT id FROM settings WHERE id='deleted-employee-rollback'").get());
 assert.equal((await call('/api/auth/me',{cookie:rollback.cookie})).status,200);
 db.exec('DROP TRIGGER fail_delete');
 const logistic=await fixture('removed-logistic',undefined,'logistic');assert.equal((await remove('admin',logistic.e,'release')).status,200);
 console.log('Employee deletion passed: all statuses, same-department transfer, release routing, role restrictions, stale versions, session revocation, audit history and atomic rollback.');
 const editor=await fixture('editing-logistic','1','logistic');records('one');
 for(const status of statuses){
  const id='one-o-'+status;
  const body={action:'updateOrder',id,version:1,address:'Corrected address',delivery:'cdek_courier',comment:'Confirmed with client'};
  const r=await call('/api/crm',{cookie:editor.cookie,body});
  assert.equal(r.status,['redeemed','returned'].includes(status)?400:200,status+': '+r.text);
  const saved=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(id).data);
  assert.deepEqual(saved.items,[]);
  if(r.status===200){assert.equal(saved.address,body.address);assert.equal(saved.comment,body.comment);assert.equal(saved.status,status);}
 }
 const editId='one-o-confirm';
 assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action:'updateOrder',id:editId,version:2,items:[{name:'Injected',quantity:1,price:1}]}})).status,400);
 for(const state of ['creating','ready']){
  db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('cdek-shipment-'+editId,JSON.stringify({state,number:'test-number'}));
  for(const action of ['updateOrder','updateWaybillComment'])assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action,id:editId,version:2,address:'Blocked',text:'Blocked'}})).status,400,state+' '+action);
 }
 assert.equal(JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(editId).data).address,'Corrected address');
 console.log('Logistic edits passed: every status, immutable basket, exported and in-flight shipment guards.');
 console.log('HTTP auth passed: login, refresh, scopes, actor spoofing, CSRF, account creation/reset/disable, session revocation, logout and rate limiting.');
}catch(e){console.error(logs);throw e;}finally{if(server){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

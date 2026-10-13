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
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3098',base=`http://127.0.0.1:${port}`;
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
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_PHONE_USER:'pilot-test',CRM_PHONE_PASSWORD:'fixture-secret',CRM_PHONE_TEST_NUMBER:'79990000001',CRM_PHONE_CALLER_ID:'79000000000',CRM_PHONE_EMPLOYEE:'admin',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,{cookie,body,headers={},method}={}){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,headers:r.headers,text};}
 async function login(name,pw=password){return call('/api/auth/login',{body:{login:name,password:pw}});}
 const cookies={};for(const id of ['admin','one','head']){const r=await login(id);assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await call('/api/telephony')).status,401);
 for(const id of ['one','head'])for(const body of [undefined,{mode:'test'}])assert.equal((await call('/api/telephony',{cookie:cookies[id],body})).status,403);
 const status=await call('/api/telephony',{cookie:cookies.admin});assert.equal(status.data.configured,true);assert.ok(!status.text.includes('fixture-secret'));assert.ok(!status.text.includes('pilot-test'));assert.equal(status.headers.get('cache-control'),'no-store');
 const dial=body=>call('/api/telephony',{cookie:cookies.admin,body});
 for(const body of [{mode:'test'},{mode:'echo'},{mode:'client',clientId:'c-one'},{mode:'order',orderId:'o-one'}]){
  const r=await dial(body);assert.equal(r.status,200,r.text);assert.equal(r.data.destination,body.mode==='echo'?'echo':'test');assert.equal(r.headers.get('cache-control'),'no-store');
 }
 for(const body of [{mode:'client',clientId:'c-two'},{mode:'order',orderId:'o-two'},{mode:'client',clientId:'missing'},{mode:'number',phone:'79990000001'}])assert.equal((await dial(body)).status,400);
 assert.equal((await dial({mode:'order',orderId:'missing'})).status,403);
 assert.equal((await dial({mode:'test',phone:'79999999999',destination:'arbitrary'})).data.destination,'test');
 assert.equal((await dial({mode:'test',actorId:'one'})).status,403);
 assert.equal((await call('/api/telephony',{cookie:cookies.admin,body:{mode:'test'},headers:{Origin:'https://evil.test'}})).status,403);
 db.prepare('UPDATE clients SET phone=? WHERE id=?').run('8 (999) 000-00-01','c-one');
 assert.equal((await dial({mode:'client',clientId:'c-one'})).status,200);
 db.prepare('UPDATE employees SET data=? WHERE id=?').run(JSON.stringify({...staff[1],role:'admin'}),'one');
 assert.equal((await call('/api/telephony',{cookie:cookies.one,body:{mode:'test'}})).status,403);
 console.log('Telephony pilot: authentication, dedicated admin, CSRF, fixed destinations, card phone normalization, private config and no-store passed. No calls placed.');
}catch(error){console.error(logs);throw error;}
finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

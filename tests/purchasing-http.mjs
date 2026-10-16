// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {courierBalance} from '../lib/courier.ts';
import {moscowDate} from '../lib/base-distribution.ts';
import {authSchema} from '../lib/auth-schema.ts';
import {cashSpendPurposes} from '../lib/cash.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-auth-')), db=new DatabaseSync(join(dir,'test.sqlite'));
const password='test-password-only-123',changed='changed-password-only-456';
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3097',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[['admin','admin','1'],['one','operator','1'],['two','operator','2'],['head','department_head','1'],['elena','purchasing','']].map(([id,role,department])=>({id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department,salary:100,bonus:1,version:1}));
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
 const cookies={};for(const id of ['admin','elena']){const r=await login(id);assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 const own=await call('/api/crm',{cookie:cookies.elena});assert.equal(own.status,200,own.text);
 for(const key of ['clients','orders','events','incoming','tasks','reminders'])assert.deepEqual(own.data[key],[],key);
 assert.deepEqual(own.data.employees.map(e=>e.id),['elena']);
 for(const path of ['/api/redemption','/api/activity','/api/call-history','/api/telephony','/api/warehouse?points=1'])assert.equal((await call(path,{cookie:cookies.elena})).status,403,path);
 assert.equal((await call('/api/crm',{cookie:cookies.elena,body:{action:'settings',retentionDays:2}})).status,403);
 const warehouse=await call('/api/warehouse',{cookie:cookies.elena});assert.equal(warehouse.status,200,warehouse.text);assert.ok(Array.isArray(warehouse.data.products));
 assert.equal((await call('/api/warehouse',{cookie:cookies.elena,body:{action:'stock'}})).status,403);
 for(const id of ['admin','elena']){
  const r=await call('/api/cash',{cookie:cookies[id],body:{action:'create',operation:{id:crypto.randomUUID(),kind:'add',amount:id==='admin'?900:100,purpose:'Fixture '+id,date:moscowDate()}}});assert.equal(r.status,200,r.text);
 }
 const cash=await call('/api/cash',{cookie:cookies.elena});assert.equal(cash.status,200,cash.text);assert.equal(cash.data.balance,10000);assert.equal(cash.data.operations.length,1);assert.equal(cash.data.operations[0].recipient,'elena');
 for(const query of ['scope=all','employeeId=admin','actorId=admin'])assert.equal((await call('/api/cash?'+query,{cookie:cookies.elena})).status,403,query);
 assert.equal((await call('/api/cash',{cookie:cookies.elena,body:{actorId:'admin',action:'create'}})).status,403);
 const accounts=await call('/api/cash?scope=all',{cookie:cookies.admin});assert.ok(accounts.data.accounts.some(e=>e.id==='elena'));
 const created=await call('/api/crm',{cookie:cookies.admin,body:{action:'saveEmployee',employee:{name:'Purchasing fixture',alias:'',login:'purchasing-new',skLogin:'',role:'purchasing',salary:0,bonus:0,accessEnabled:false}}});assert.equal(created.status,200,created.text);assert.ok(created.data.state.employees.some(e=>e.login==='purchasing-new'&&e.role==='purchasing'));
 console.log('Purchasing: employee creation, own cash, isolation, warehouse read-only and endpoint restrictions passed.');
}catch(e){console.error(logs);throw e;}finally{if(server){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

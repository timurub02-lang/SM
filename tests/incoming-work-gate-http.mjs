// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {createHmac} from 'node:crypto';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-auth-')), db=new DatabaseSync(join(dir,'test.sqlite'));
const password='test-password-only-123',pbxKey='fixture-pbx-result-key-not-a-real-secret';
const origin='https://crm.test',port=process.env.AUTH_TEST_PORT||'3107',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[['admin','admin','1'],['one','operator','1'],['two','operator','2'],['head','department_head','1'],['head2','department_head','2'],['head0','department_head',''],['logistic','logistic',''],['chief','chief_logistic',''],['redemption','redemption',''],['courier','courier','']].map(([id,role,department])=>({id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department,salary:100,bonus:1,version:1}));
 for(const e of staff){db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,hash);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 for(const id of ['one','two']){
  const c={id:'c-'+id,name:'Client '+id,phone:id==='one'?'+79990000001':'+79990000002',city:'',address:'',source:'Test',owner:id,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version:1};
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+id,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_PHONE_STAFF_ENABLED:'1',CRM_PHONE_RESULT_KEY:pbxKey,CRM_PHONE_RECORDINGS_DIR:join(dir,'recordings'),CRM_PHONE_USER:'pilot-test',CRM_PHONE_PASSWORD:'fixture-secret',CRM_PHONE_TEST_NUMBER:'79990000001',CRM_PHONE_CALLER_ID:'79000000000',CRM_PHONE_EMPLOYEE:'admin',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(ready,'Server failed to start');
 async function call(path,{cookie,body,headers={},method}={}){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,headers:r.headers,text};}
 async function login(name,pw=password){return call('/api/auth/login',{body:{login:name,password:pw}});}
 const cookies={};for(const {id} of staff){const r=await login(id);assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}

 const request=(who,path,body)=>call(path,{cookie:cookies[who],body});
 const version=id=>db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;
 await request('one','/api/crm');
 const client={id:'incoming-client',name:'Тестовый Клиент Входящий',phone:'+79990000444',city:'Москва',address:'Москва, Тверская, 1',source:'Test',owner:'one',assignedUntil:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(client.id,client.phone,JSON.stringify(client));
 const related={...JSON.parse(db.prepare("SELECT data FROM orders WHERE id='o-one'").get().data),id:'related',clientId:client.id,status:'shipping'};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(related.id,client.id,JSON.stringify(related));
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('fixture-product','товар',JSON.stringify({name:'Товар'}));
 db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('fixture-stock','fixture-product',100,'Synthetic fixture','admin',new Date().toISOString());
 db.prepare("UPDATE orders SET data=json_set(data,'$.skLeadId','fixture-lead','$.delivery','russian_post','$.items',json(?),'$.address','101000, Москва, Тверская, д. 1') WHERE id='o-one'").run(JSON.stringify([{name:'Товар',quantity:1,price:1000}]));
 function add(id){db.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number) VALUES(?,?,?,?,?,?,?)').run(id,client.id,'one','1',new Date().toISOString(),client.phone,'+79990000000');}
 add('first');
 const status=()=>request('one','/api/incoming-work-gate');
 let gate=await status();assert.equal(gate.status,200,gate.text);assert.deepEqual(gate.data.incomingIds,['first']);assert.ok(gate.data.skOrders.some(o=>o.id==='o-one'));
 assert.equal((await request('two','/api/incoming-work-gate')).data.incomingIds.length,0);
 let forged=await request('one','/api/crm',{action:'createOrder',clientId:'c-one',incomingId:'fake',items:[]});assert.equal(forged.status,400,forged.text);
 let r=await request('one','/api/crm',{action:'createClient',name:'Blocked',phone:'+79990000055'});assert.equal(r.status,423,r.text);assert.equal(r.data.incomingWorkBlocked,true);
 r=await request('one','/api/crm',{action:'comment',id:'o-one',version:version('o-one'),text:'Finished checking data'});assert.equal(r.status,200,r.text);
 // A direct request cannot turn the SK exception into unrelated work or an early result.
 r=await request('one','/api/crm',{action:'contact',id:'o-one',version:version('o-one'),contact:'missed',reason:'No answer'});assert.equal(r.status,423,r.text);
 r=await request('one','/api/crm',{action:'transition',id:'o-one',version:version('o-one'),to:'confirm',incompleteNameReason:'Synthetic fixture'});assert.equal(r.status,200,r.text);
 gate=await status();assert.ok(!gate.data.skOrders.some(o=>o.id==='o-one'),'Sending SK order to logistic consumes its exception');
 r=await request('one','/api/crm',{action:'comment',id:'o-one',version:version('o-one'),text:'Not incoming work'});assert.equal(r.status,423,r.text);
 r=await request('head','/api/crm',{action:'missIncoming',incomingId:'first'});assert.equal(r.status,200,r.text);assert.equal((await status()).data.incomingIds.length,0,'Head ND releases operator');
 const ordersBefore=db.prepare('SELECT id,data,version FROM orders ORDER BY id').all();
 db.prepare("UPDATE incoming_calls SET missed_until=? WHERE id='first'").run(new Date(Date.now()-1000).toISOString());assert.equal((await status()).data.incomingIds.length,1,'One-hour expiry blocks again');
 add('second');
 r=await request('head','/api/crm',{action:'incomingResult',incomingId:'first',id:'related',reason:'Consulted by head'});assert.equal(r.status,200,r.text);assert.equal((await status()).data.incomingIds.length,1);
 r=await request('head','/api/crm',{action:'incomingResult',incomingId:'second',id:'related',reason:'Resolved by head'});assert.equal(r.status,200,r.text);assert.equal((await status()).data.incomingIds.length,0,'Head close releases operator');
 assert.deepEqual(db.prepare('SELECT id,data,version FROM orders ORDER BY id').all(),ordersBefore,'Incoming results do not mutate orders');
 r=await request('one','/api/warehouse');assert.equal(r.status,200,r.text);
 console.log('HTTP incoming work gate: fresh authoritative scope, 423 direct-write guard, SK save/handoff, head ND/close release, expiry and multiple incoming passed');
}catch(error){console.error(logs);throw error;}finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

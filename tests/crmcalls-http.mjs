import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
const dir=mkdtempSync(join(tmpdir(),'crmcalls-http-')),database=join(dir,'test.sqlite'),d=new DatabaseSync(database);
const port=process.env.CRMCALLS_TEST_PORT||'3493',origin='http://127.0.0.1:'+port,password='synthetic-test-only',key='crmc_live_synthetic_secret';
let server,logs='';
try{
 d.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));
 for(const sql of authSchema)d.exec(sql);
 const hash=await hashPassword(password);
 for(const role of ['admin','operator','department_head','chief_logistic','logistic','courier','redemption','purchasing']){
  const e={id:role,login:role,name:'Тест '+role,role,department:'test',version:1};
  d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(role,JSON.stringify(e));
  d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(role,hash);
 }
 d.prepare('INSERT INTO settings VALUES(?,?)').run('base-settings',JSON.stringify({config:initialBaseSettings()}));
 d.prepare('INSERT INTO settings VALUES(?,?)').run('crmcalls-connection',JSON.stringify({apiKey:key,revision:'v1'}));
 for(let i=0;i<5;i++)d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c'+i,'7999000010'+i,JSON.stringify({id:'c'+i,phone:'7999000010'+i,name:'Клиент '+i,city:'Москва',address:'Тестовая улица',baseType:'M',sheet:'П',owner:''}));
 server=spawn(process.execPath,['--import',resolve('tests/fixtures/crmcalls-api.mjs'),resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:database,PORT:port,HOSTNAME:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(origin+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(path,cookie,body,headers={}){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,text:await r.text()};}
 const cookies={};for(const role of ['admin','operator','department_head','chief_logistic','logistic','courier','redemption','purchasing']){const r=await call('/api/auth/login',null,{login:role,password});assert.equal(r.status,200,r.text);cookies[role]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await call('/api/crmcalls')).status,401);
 for(const role of Object.keys(cookies).filter(r=>r!=='admin')){
  assert.equal((await call('/api/crmcalls?actorId=admin',cookies[role])).status,403,role);
  assert.equal((await call('/api/crmcalls',cookies[role],{action:'save'})).status,403,role);
 }
 const status=await call('/api/crmcalls',cookies.admin);assert.equal(status.status,200,status.text);assert.ok(!status.text.includes(key));assert.equal(JSON.parse(status.text).connection.configured,true);
 const schedule={projectId:'11111111-1111-4111-8111-111111111111',base:'M',sheet:'П',cycleDays:3,sendTime:'09:00',enabled:false};
 assert.equal((await call('/api/crmcalls?actorId=operator',cookies.admin)).status,403);
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'save',schedule,revision:''},{Origin:'https://evil.test'})).status,403);
 for(const sheet of ['К','ЧС','ПВ'])assert.equal((await call('/api/crmcalls',cookies.admin,{action:'preview',schedule:{...schedule,sheet}})).status,400);
 const preview=await call('/api/crmcalls',cookies.admin,{action:'preview',schedule});assert.equal(preview.status,200,preview.text);assert.equal(JSON.parse(preview.text).count,5);assert.equal(JSON.parse(preview.text).plan.length,3);
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'save',schedule,revision:''})).status,200);
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'save',schedule,revision:''})).status,400);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM crmcalls_items').get().n,0,'Disabled schedule sends and queues nothing');
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM crmcalls_batches').get().n,0);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM clients').get().n,5);
 const projects=await call('/api/crmcalls?projects=1',cookies.admin);assert.equal(projects.status,200,projects.text);assert.equal(JSON.parse(projects.text).projects.length,5);
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'connect',apiKey:key,revision:'v1'})).status,200);
 assert.ok(!(await call('/api/crmcalls',cookies.admin)).text.includes(key));
 console.log('CRMCalls HTTP: all non-admin roles denied, identity/CSRF, protected sheets, secret masking, preview, CAS and disabled scheduling passed');
 if(process.env.CRMCALLS_UI_TEST==='1'){
  console.log('Synthetic UI available on '+origin+'; admin / '+password);
  await new Promise(resolve=>process.once('SIGTERM',resolve));
 }
}catch(e){console.error(logs);throw e;}finally{server?.kill('SIGTERM');d.close();rmSync(dir,{recursive:true,force:true});}

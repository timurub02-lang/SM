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
 const missingProject='99999999-9999-4999-8999-999999999999';
 d.prepare('INSERT INTO settings VALUES(?,?)').run('crmcalls-project-'+missingProject,JSON.stringify({...schedule,projectId:missingProject,enabled:true,revision:'missing-v1',planning:'daily'}));
 const current=JSON.parse((await call('/api/crmcalls',cookies.admin)).text).schedules[0];
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'save',schedule:{...schedule,enabled:true},revision:current.revision})).status,200);
 assert.equal(JSON.parse(d.prepare('SELECT data FROM settings WHERE id=?').get('crmcalls-project-'+missingProject).data).enabled,false,'Missing project no longer blocks the live project');
 const conflicting=initialBaseSettings();Object.assign(conflicting.M.sheets.find(s=>s.name==='П'),{automatic:true,projectId:'123'});
 const conflict=await call('/api/base',cookies.admin,{config:conflicting,revision:''});assert.equal(conflict.status,400,conflict.text);assert.match(conflict.text,/CRMCalls/);
 const enabled=JSON.parse((await call('/api/crmcalls',cookies.admin)).text).schedules[0];
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'save',schedule,revision:enabled.revision})).status,200);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM crmcalls_items').get().n,0,'Saving a schedule does not freeze or submit the whole base');
 const directory=await call('/api/crmcalls?directory=1',cookies.admin);assert.equal(directory.status,200,directory.text);
 const incomingConfig={enabled:true,scenarioId:'11111111-1111-4111-8111-111111111119',resultId:'sm-result',operators:[{userId:'11111111-1111-4111-8111-111111111110',employeeId:'operator'}]};
 assert.equal((await call('/api/crmcalls',cookies.operator,{action:'saveIncoming',config:incomingConfig,revision:''})).status,403);
 const saveIncoming=await call('/api/crmcalls',cookies.admin,{action:'saveIncoming',config:incomingConfig,revision:''});assert.equal(saveIncoming.status,200,saveIncoming.text);
 const incomingSecret=JSON.parse(saveIncoming.text).secret;assert.equal(incomingSecret.length,64);
 const payload={event:'call.result_saved',event_id:crypto.randomUUID(),occurred_at:new Date().toISOString(),scenario:{id:incomingConfig.scenarioId},result:{id:'sm-result',name:'СМ СРМ'},user:{id:incomingConfig.operators[0].userId,name:'Тест CRMCalls оператор'},call:{id:crypto.randomUUID(),status:'completed',comment:'Тест передачи'},contact:{id:crypto.randomUUID(),phone:'79990000888',full_name:'Синтетический клиент'}};
 assert.equal((await call('/api/crmcalls-incoming',null,payload)).status,403);
 const eventHeaders={Authorization:'Bearer '+incomingSecret,'Idempotency-Key':payload.event_id};
 assert.equal((await call('/api/crmcalls-incoming',null,payload,eventHeaders)).status,200);
 assert.equal((await call('/api/crmcalls-incoming',null,payload,eventHeaders)).status,200);
 const received=JSON.parse((await call('/api/crmcalls?incoming=1',cookies.admin)).text);assert.equal(received.transfers[0].state,'imported');assert.ok(!JSON.stringify(received).includes(incomingSecret));
 const incomingOrders=d.prepare('SELECT data FROM orders').all().map(r=>JSON.parse(r.data));assert.equal(incomingOrders.length,1);assert.equal(incomingOrders[0].manager,'operator');assert.equal(incomingOrders[0].status,'draft');assert.deepEqual(incomingOrders[0].items,[]);
 const bothConfig={...received.config,additionalScenarios:[{scenarioId:'22222222-2222-4222-8222-222222222222',resultId:'sm-j'}]};
 assert.equal((await call('/api/crmcalls',cookies.admin,{action:'saveIncoming',config:{...bothConfig,additionalScenarios:[{...bothConfig.additionalScenarios[0],resultId:'sm-result'}]},revision:received.config.revision})).status,400);
 const saveBoth=await call('/api/crmcalls',cookies.admin,{action:'saveIncoming',config:bothConfig,revision:received.config.revision});assert.equal(saveBoth.status,200,saveBoth.text);
 const second={...payload,event_id:crypto.randomUUID(),scenario:{id:bothConfig.additionalScenarios[0].scenarioId},result:{id:'sm-j'},call:{id:crypto.randomUUID()},contact:{id:crypto.randomUUID(),phone:'79990000777'}};
 assert.equal((await call('/api/crmcalls-incoming',null,second,{...eventHeaders,'Idempotency-Key':second.event_id})).status,200);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM orders').get().n,2);
 const bothDashboard=JSON.parse((await call('/api/crmcalls?incoming=1',cookies.admin)).text);assert.deepEqual(bothDashboard.config.operators,incomingConfig.operators);assert.deepEqual(bothDashboard.config.additionalScenarios,bothConfig.additionalScenarios);
 // The shared approval endpoint protects ownership and performs both decisions atomically.
 const owned={id:'protected-cc',name:'Чужой клиент',phone:'+79990000999',owner:'original-owner',sheet:'К',baseType:'M',city:'',address:'',createdAt:new Date().toISOString(),version:1};
 d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(owned.id,owned.phone,JSON.stringify(owned));
 const conflictEvent={...payload,event_id:crypto.randomUUID(),call:{id:crypto.randomUUID()},contact:{id:crypto.randomUUID(),phone:owned.phone,full_name:owned.name}};
 const submitConflict=async e=>{const r=await call('/api/crmcalls-incoming',null,e,{...eventHeaders,'Idempotency-Key':e.event_id});assert.equal(r.status,200,r.text);};
 await submitConflict(conflictEvent);
 let pending=JSON.parse((await call('/api/sk-orders',cookies.admin)).text).rows;
 const transferId='cc:'+conflictEvent.call.id;assert.equal(pending.length,1);assert.equal(pending[0].id,transferId);assert.equal(pending[0].source,'CRMCalls');assert.match(pending[0].reason,/другому оператору/);
 const operatorRows=JSON.parse((await call('/api/sk-orders',cookies.operator)).text).rows;assert.equal(operatorRows[0].id,transferId);assert.equal(operatorRows[0].canDecide,false);assert.equal(operatorRows[0].phone,undefined);
 for(const role of ['operator','department_head'])for(const action of ['approve','reject'])assert.equal((await call('/api/sk-orders',cookies[role],{id:transferId,action})).status,403);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM orders').get().n,2);
 const rejected=await call('/api/sk-orders',cookies.admin,{id:transferId,action:'reject'});assert.equal(rejected.status,200,rejected.text);
 await submitConflict(conflictEvent);
 assert.equal(d.prepare('SELECT state FROM crmcalls_incoming WHERE call_id=?').get(conflictEvent.call.id).state,'rejected');
 assert.equal(JSON.parse(d.prepare('SELECT data FROM clients WHERE id=?').get(owned.id).data).owner,'original-owner');
 const approveEvent={...conflictEvent,event_id:crypto.randomUUID(),call:{id:crypto.randomUUID()}};await submitConflict(approveEvent);
 const approved=await call('/api/sk-orders',cookies.admin,{id:'cc:'+approveEvent.call.id,action:'approve'});assert.equal(approved.status,200,approved.text);assert.equal(JSON.parse(approved.text).state,'imported');
 assert.equal(d.prepare('SELECT COUNT(*) n FROM orders').get().n,3);
 assert.equal(JSON.parse(d.prepare('SELECT data FROM clients WHERE id=?').get(owned.id).data).owner,'operator');
 assert.equal((await call('/api/sk-orders',cookies.admin,{id:'cc:'+approveEvent.call.id,action:'approve'})).status,400);
 await submitConflict(approveEvent);assert.equal(d.prepare('SELECT COUNT(*) n FROM orders').get().n,3);
 console.log('CRMCalls HTTP: all non-admin roles denied, identity/CSRF, protected sheets, secret masking, preview, CAS and disabled scheduling passed');
 if(process.env.CRMCALLS_UI_TEST==='1'){
  console.log('Synthetic UI available on '+origin+'; admin / '+password);
  await new Promise(resolve=>process.once('SIGTERM',resolve));
 }
}catch(e){console.error(logs);throw e;}finally{server?.kill('SIGTERM');d.close();rmSync(dir,{recursive:true,force:true});}

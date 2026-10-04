// Run after the Miran standalone build. Uses only a temporary, synthetic database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {courierBalance} from '../lib/courier.ts';
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
 for(const row of db.prepare("SELECT data FROM clients WHERE id LIKE 'release-c-%'").all()){const c=JSON.parse(row.data),status=c.id.replace('release-c-','');assert.equal(c.owner,'');assert.equal(c.sheet,live.includes(status)?'К':status==='redeemed'?'П':'Т3');}
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
 const noticeId='one-o-packing';
 const savedOrder=()=>JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(noticeId).data);
 assert.equal(savedOrder().deliveryReset,undefined);
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...savedOrder(),manualDeliveryCost:0,packingWaybillAt:new Date().toISOString()}),noticeId);
 async function editNotice(body){const version=db.prepare('SELECT version FROM orders WHERE id=?').get(noticeId).version;const r=await call('/api/crm',{cookie:editor.cookie,body:{id:noticeId,version,...body}});assert.equal(r.status,200,r.text);return savedOrder();}
 let notice=await editNotice({action:'updateOrder',address:'New address',delivery:'moscow_courier',comment:'Correction'});
 assert.equal(notice.deliveryReset.calculation,true);assert.equal(notice.deliveryReset.waybill,true);assert.equal(notice.manualDeliveryCost,undefined);assert.equal(notice.packingWaybillAt,undefined);
 notice=await editNotice({action:'updateOrder',address:'New address',delivery:'moscow_courier',comment:'Another comment'});assert.equal(notice.deliveryReset.waybill,true);
 notice=await editNotice({action:'saveManualDeliveryCost',amount:0});assert.equal(notice.deliveryReset.calculation,false);assert.equal(notice.deliveryReset.waybill,true);
 notice=await editNotice({action:'markPackingWaybill'});assert.equal(notice.deliveryReset,undefined);
 console.log('Delivery reset notice: absent before calculation, persists after edits, clears only after replacements.');
 const returnOperator=await fixture('return-flow');records('return-flow');
 const flowId='return-flow-o-confirm';
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('return-product','test',JSON.stringify({name:'Test'}));
 db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('return-stock','return-product',10,'Fixture','admin',new Date().toISOString());
 const flow=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(flowId).data);
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...flow,address:'Address',delivery:'cdek_courier',items:[{name:'Test',quantity:1,price:1}]}),flowId);
 async function step(cookie,to,expected=200){
  const version=db.prepare('SELECT version FROM orders WHERE id=?').get(flowId).version;
  const r=await call('/api/crm',{cookie,body:{action:'transition',id:flowId,version,to,reason:'Test reason',finalHandoffConfirmed:true}});
  assert.equal(r.status,expected,r.text);return JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(flowId).data);
 }
 await step(editor.cookie,'refused',400);
 await step(editor.cookie,'rework');let flowOrder=await step(returnOperator.cookie,'confirm');assert.equal(flowOrder.round,2);assert.ok(flowOrder.finalHandoffAt);
 await step(editor.cookie,'rework',400);
 await step(editor.cookie,'check');flowOrder=await step(cookies.admin,'extra');assert.equal(flowOrder.round,2);assert.equal(flowOrder.finalHandoffAt,undefined);
 await step(editor.cookie,'refused',400);
 await step(editor.cookie,'rework');flowOrder=await step(returnOperator.cookie,'extra');assert.equal(flowOrder.round,3);assert.ok(flowOrder.finalHandoffAt);
 await step(editor.cookie,'rework',400);await step(editor.cookie,'refused');
 console.log('Return workflow: cancellation denied before return in each stage; second return permits cancellation.');
 const chief=await fixture('chief-logistic',undefined,'chief_logistic');
 const dispatchCourier=await fixture('dispatch-courier',undefined,'courier'),strangerCourier=await fixture('stranger-courier',undefined,'courier');
 for(const [delivery,section] of [['moscow_courier','moscow'],['russian_post','post']]){
  const id='manual-'+delivery,clientId='one-c-confirm';
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(id,clientId,JSON.stringify({...flow,id,clientId,status:'confirm',delivery,address:'Address',items:[{name:'Test',quantity:1,price:1}]}));
  async function manualStep(to,expected=200){const version=db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;const r=await call('/api/crm',{cookie:editor.cookie,body:{action:'transition',id,version,to,reason:'Test',courierId:dispatchCourier.e.id}});assert.equal(r.status,expected,r.text);return JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(id).data);}
  await manualStep('check',400);await manualStep('refused',400);
  let saved=await manualStep('extra');assert.equal(saved.adminReviewedAt,undefined);assert.ok(saved.confirmedAt);assert.equal(saved.finalHandoffAt,undefined);
  await manualStep('refused',400);saved=await manualStep('packing');assert.equal(saved.delivery,delivery);assert.equal(saved.cdekTariff,undefined);assert.equal(saved.manualDeliveryCost,undefined);assert.equal(saved.packingWaybillAt,undefined);
  await manualStep('shipping',400);
  const version=db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;
  assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action:'markPackingWaybill',id,version}})).status,200);
  saved=await manualStep('shipping');assert.ok(saved.shippedAt);assert.equal(saved.status,'shipping');
  await manualStep('shipping',400);
  async function receive(expected,amount){const version=db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;const r=await call('/api/crm',{cookie:editor.cookie,body:{action:'receivePayment',id,version,amount}});assert.equal(r.status,expected,r.text);return JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(id).data);}
  await receive(400);
  if(delivery==='russian_post')saved=await manualStep('redeemed');
  else {
   await manualStep('redeemed',400);
   let courierView=(await call('/api/crm',{cookie:dispatchCourier.cookie})).data;
   assert.equal(courierBalance(courierView.orders,dispatchCourier.e.id).pending,1);
   assert.equal(courierBalance(courierView.orders,dispatchCourier.e.id).total,0);
   const beforeAccept=db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;
   assert.equal((await call('/api/crm',{cookie:dispatchCourier.cookie,body:{action:'courierOutcome',id,version:beforeAccept,to:'redeemed',confirmed:true}})).status,400);
   const acceptance={action:'courierAccept',id,version:beforeAccept,confirmed:true};
   assert.equal((await call('/api/crm',{cookie:strangerCourier.cookie,body:acceptance})).status,400);
   const accepted=await call('/api/crm',{cookie:dispatchCourier.cookie,body:acceptance});assert.equal(accepted.status,200,accepted.text);
   assert.ok(accepted.data.state.orders.find(o=>o.id===id).courier.acceptedAt);
   assert.equal(courierBalance(accepted.data.state.orders,dispatchCourier.e.id).parcels,1);
   assert.equal((await call('/api/crm',{cookie:dispatchCourier.cookie,body:acceptance})).status,400);
   const version=db.prepare('SELECT version FROM orders WHERE id=?').get(id).version;
   const body={action:'courierOutcome',id,version,to:'redeemed',confirmed:true};
   assert.equal((await call('/api/crm',{cookie:strangerCourier.cookie,body})).status,400);
   assert.equal((await call('/api/crm',{cookie:editor.cookie,body})).status,400);
   assert.equal((await call('/api/crm',{cookie:dispatchCourier.cookie,body:{...body,action:'updateOrder',items:[]}})).status,403);
   assert.equal((await call('/api/crm',{cookie:dispatchCourier.cookie,body:{...body,confirmed:false}})).status,400);
   const paid=await call('/api/crm',{cookie:dispatchCourier.cookie,body});assert.equal(paid.status,200,paid.text);
   assert.equal(courierBalance(paid.data.state.orders,dispatchCourier.e.id).cash,1);
   assert.equal((await call('/api/crm',{cookie:dispatchCourier.cookie,body})).status,400);
   assert.equal((await call('/api/crm',{cookie:returnOperator.cookie})).data.orders.find(o=>o.id===id).status,'redeemed');
   saved=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(id).data);
  }
  assert.ok(saved.redeemedAt);
  const paidAt=saved.redeemedAt;
  saved=await receive(200,delivery==='moscow_courier'?99999:undefined);assert.equal(saved.status,'redeemed');assert.equal(saved.redeemedAt,paidAt);assert.ok(saved.paymentReceivedAt);assert.equal(saved.paymentReceivedBy,editor.e.id);assert.equal(saved.paymentReceipt.amount,1);assert.equal(saved.paymentReceipt.receivedByName,editor.e.name);assert.equal(saved.paymentReceipt.delivery,delivery);assert.equal(saved.paymentReceipt.operatorLogin,JSON.parse(db.prepare("SELECT data FROM employees WHERE id=?").get(saved.manager).data).login);
  await receive(400);
 }

 assert.equal(courierBalance((await call('/api/crm',{cookie:dispatchCourier.cookie})).data.orders,dispatchCourier.e.id).total,0);
 const courierReturnId='courier-return';
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(courierReturnId,'one-c-confirm',JSON.stringify({...flow,id:courierReturnId,clientId:'one-c-confirm',status:'packing',delivery:'moscow_courier',address:'Address',packingWaybillAt:new Date().toISOString(),items:[{name:'Test',quantity:1,price:1}]}));
 async function courierAction(cookie,body,expected=200){const version=db.prepare('SELECT version FROM orders WHERE id=?').get(courierReturnId).version;const r=await call('/api/crm',{cookie,body:{id:courierReturnId,version,...body}});assert.equal(r.status,expected,r.text);return r;}
 await courierAction(editor.cookie,{action:'transition',to:'shipping'},400);
 await courierAction(editor.cookie,{action:'transition',to:'shipping',courierId:editor.e.id},400);
 db.prepare("UPDATE employees SET data=json_set(data,'$.role','operator') WHERE id=?").run(strangerCourier.e.id);
 await courierAction(editor.cookie,{action:'transition',to:'shipping'});
 assert.equal(JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(courierReturnId).data).courier.id,dispatchCourier.e.id);
 db.prepare("UPDATE employees SET data=json_set(data,'$.role','courier') WHERE id=?").run(strangerCourier.e.id);
 await courierAction(editor.cookie,{action:'updateDelivery',delivery:'russian_post'},400);
 assert.equal((await call('/api/crm',{cookie:cookies.admin,body:{action:'deleteEmployee',id:dispatchCourier.e.id,version:1,mode:'release'}})).status,400);
 await courierAction(dispatchCourier.cookie,{action:'returnToWarehouse'},403);
 await courierAction(dispatchCourier.cookie,{action:'receivePayment'},403);
 await courierAction(dispatchCourier.cookie,{action:'courierOutcome',to:'returned',confirmed:true,reason:'Client refused'},400);
 await courierAction(dispatchCourier.cookie,{action:'courierAccept',confirmed:false},400);
 await courierAction(dispatchCourier.cookie,{action:'courierAccept',confirmed:true});
 await courierAction(dispatchCourier.cookie,{action:'courierAccept',confirmed:true},400);
 await courierAction(dispatchCourier.cookie,{action:'courierOutcome',to:'returned',confirmed:true,reason:''},400);
 const stockBeforeReturn=db.prepare("SELECT available FROM product_stock WHERE id='return-product'").get().available;
 const returned=await courierAction(dispatchCourier.cookie,{action:'courierOutcome',to:'returned',confirmed:true,reason:'Client refused'});
 assert.equal(courierBalance(returned.data.state.orders,dispatchCourier.e.id).parcels,1);
 assert.equal(db.prepare("SELECT available FROM product_stock WHERE id='return-product'").get().available,stockBeforeReturn);
 assert.equal((await call('/api/crm',{cookie:returnOperator.cookie})).data.orders.find(o=>o.id===courierReturnId).status,'returned');
 await courierAction(editor.cookie,{action:'returnToWarehouse'});
 assert.equal(db.prepare("SELECT available FROM product_stock WHERE id='return-product'").get().available,stockBeforeReturn+1);
 await courierAction(editor.cookie,{action:'returnToWarehouse'},400);
 assert.equal(courierBalance((await call('/api/crm',{cookie:dispatchCourier.cookie})).data.orders,dispatchCourier.e.id).total,0);
 console.log('Courier: assignment, scoped mobile data, payment, return, warehouse stock and settlement passed.');
 console.log('Manual delivery HTTP route: confirm -> extra -> packing, no admin review, cancellation blocked before return.');
 const editId='one-o-confirm';
 assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action:'updateOrder',id:editId,version:2,items:[{name:'Injected',quantity:1,price:1}]}})).status,400);
 for(const state of ['creating','ready']){
  db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('cdek-shipment-'+editId,JSON.stringify({state,number:'test-number'}));
  for(const action of ['updateOrder','updateWaybillComment'])assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action,id:editId,version:2,address:'Blocked',text:'Blocked'}})).status,400,state+' '+action);
 }
 assert.equal(JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(editId).data).address,'Corrected address');
 console.log('Logistic edits passed: every status, immutable basket, exported and in-flight shipment guards.');
 const courier=await fixture('courier',undefined,'courier');
 const chiefState=await call('/api/crm',{cookie:chief.cookie});assert.equal(chiefState.status,200);assert.ok(chiefState.data.employees.some(e=>e.id===editor.e.id&&e.hasPassword));
 for(const e of [staff[0],staff[1],chief.e])assert.equal((await call('/api/crm',{cookie:chief.cookie,body:{action:'saveEmployee',id:e.id,version:1,employee:{...e,accessEnabled:false}}})).status,400);
 const created=await call('/api/crm',{cookie:chief.cookie,body:{action:'saveEmployee',employee:{...staff[1],id:undefined,login:'chief-created',role:'admin',accessEnabled:false}}});assert.equal(created.status,200,created.text);const managed=created.data.state.employees.find(e=>e.login==='chief-created');assert.equal(managed.role,'logistic');assert.equal(managed.department,undefined);
 assert.equal((await call('/api/crm',{cookie:editor.cookie,body:{action:'saveEmployee',employee:{...staff[1],login:'forbidden'}}})).status,400);
 assert.equal((await call('/api/crm',{cookie:chief.cookie,body:{action:'deleteEmployee',id:managed.id,version:managed.version,mode:'release'}})).status,400);
 assert.equal((await call('/api/warehouse',{cookie:chief.cookie})).status,200);
 const courierState=await call('/api/crm',{cookie:courier.cookie});assert.equal(courierState.status,200);assert.equal(courierState.data.orders.length,0);assert.equal(courierState.data.clients.length,0);assert.deepEqual(courierState.data.employees.map(e=>e.id),[courier.e.id]);
 assert.equal((await call('/api/warehouse',{cookie:courier.cookie})).status,403);
 assert.equal((await call('/api/crm',{cookie:courier.cookie,body:{action:'saveEmployee',employee:{...staff[1],login:'forbidden'}}})).status,403);

 const cashHead=await fixture('cash-head','1','department_head');
 async function cash(cookie,body){return call('/api/cash',{cookie,body});}
 assert.equal((await cash(editor.cookie)).status,403);assert.equal((await cash(courier.cookie)).status,403);
 assert.equal((await cash(returnOperator.cookie)).status,403);
 assert.equal((await cash(chief.cookie)).data.balance,200,'Both delivery receipts credited chief, not accepting logistic');
 const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
 const add={action:'create',operation:{id:crypto.randomUUID(),kind:'add',amount:1000,date,purpose:'Opening cash'}};
 let cashResult=await cash(cookies.admin,add);assert.equal(cashResult.status,200,cashResult.text);assert.equal(cashResult.data.balance,100000);
 assert.equal((await cash(cookies.admin,add)).data.balance,100000,'Retry cannot duplicate cash');
 assert.equal((await cash(cookies.admin,{...add,operation:{...add.operation,amount:2000}})).status,400);
 for(const amount of [-1,0,0.001])assert.equal((await cash(cookies.admin,{...add,operation:{...add.operation,id:crypto.randomUUID(),amount}})).status,400);
 const cashTransfer={action:'create',operation:{id:crypto.randomUUID(),kind:'transfer',amount:300,date,purpose:'Перевод другому сотруднику',recipient:cashHead.e.id}};
 cashResult=await cash(cookies.admin,cashTransfer);assert.equal(cashResult.status,200,cashResult.text);assert.equal(cashResult.data.balance,70000);
 let incoming=await cash(cashHead.cookie);assert.equal(incoming.data.balance,0);assert.equal(incoming.data.operations.length,1);assert.equal(incoming.data.operations[0].accepted_at,null);assert.ok(!incoming.text.includes('manual-russian_post'));
 const overview=await call('/api/cash?scope=all',{cookie:cookies.admin});assert.equal(overview.status,200,overview.text);assert.ok(overview.data.accounts.every(a=>['admin','department_head','chief_logistic','courier'].includes(a.role)));assert.ok(!overview.data.accounts.some(a=>a.id===editor.e.id));
 assert.ok(overview.data.accounts.some(a=>a.id===dispatchCourier.e.id&&a.balance===0&&a.accountable===0));
 const courierHistory=await call('/api/cash?employeeId='+dispatchCourier.e.id,{cookie:cookies.admin});assert.equal(courierHistory.status,200);assert.equal(courierHistory.data.courierOrders.length,2);
 const headCash=overview.data.accounts.find(a=>a.id===cashHead.e.id);assert.equal(headCash.balance,0);assert.equal(headCash.pending,30000);assert.equal(headCash.name,cashHead.e.name);
 const adminHistory=await call('/api/cash?employeeId='+cashHead.e.id,{cookie:cookies.admin});assert.equal(adminHistory.status,200);assert.equal(adminHistory.data.operations.length,1);assert.equal(adminHistory.data.operations[0].id,cashTransfer.operation.id);
 for(const cookie of [cashHead.cookie,chief.cookie,editor.cookie])for(const query of ['scope=all','employeeId='+cashHead.e.id])assert.equal((await call('/api/cash?'+query,{cookie})).status,403);
 assert.equal((await call('/api/cash?employeeId='+cashHead.e.id,{cookie:cookies.admin,body:add})).status,403);

 assert.equal((await cash(chief.cookie,{action:'accept',id:cashTransfer.operation.id})).status,400);
 incoming=await cash(cashHead.cookie,{action:'accept',id:cashTransfer.operation.id});assert.equal(incoming.data.balance,30000);assert.ok(incoming.data.operations[0].accepted_at);
 const confirmedCash=(await call('/api/cash?scope=all',{cookie:cookies.admin})).data.accounts.find(a=>a.id===cashHead.e.id);assert.equal(confirmedCash.balance,30000);assert.equal(confirmedCash.pending,0);
 assert.equal((await cash(cashHead.cookie,{action:'accept',id:cashTransfer.operation.id})).data.balance,30000);
 const spend={action:'create',operation:{id:crypto.randomUUID(),kind:'spend',amount:800,date,purpose:'Зарплата'}};
 assert.equal((await cash(cookies.admin,spend)).status,400);assert.equal((await cash(cookies.admin)).data.balance,70000);
 const spends=await Promise.all([1,2].map(()=>cash(cookies.admin,{...spend,operation:{...spend.operation,id:crypto.randomUUID(),amount:500}})));
 assert.deepEqual(spends.map(x=>x.status).sort(),[200,400]);assert.equal((await cash(cookies.admin)).data.balance,20000);
 assert.equal((await call('/api/cash?actorId='+cashHead.e.id,{cookie:cookies.admin})).status,403);
 for(const [purpose,balance] of [['Уборка',20000],['Аренда',10000]]){
  const expense={action:'create',operation:{id:crypto.randomUUID(),kind:'spend',amount:100,date,purpose}};
  const result=await cash(cashHead.cookie,expense);assert.equal(result.status,200,result.text);assert.equal(result.data.balance,balance);assert.ok(result.data.operations.some(o=>o.id===expense.operation.id&&o.purpose===purpose));
  assert.equal((await cash(cashHead.cookie,expense)).data.balance,balance);
  assert.equal((await cash(cashHead.cookie,{...expense,operation:{...expense.operation,id:crypto.randomUUID(),purpose:'Неизвестное назначение'}})).status,400);
 }
 console.log('Cash: delivery receipts, private balances, pending transfers, confirmation, retries, insufficient funds and concurrent spending passed.');
 console.log('Chief logistics and courier: scoped employee management, no role escalation, logistics access and courier isolation passed.');

 const reminderActor=await fixture('reminder-operator');records('reminder-operator');
 const reminderOrder='reminder-operator-o-draft';
 for(let i=0;i<25;i++){
  const o=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(reminderOrder).data);
  o.contact='callback';o.due=new Date(Date.now()+86400000+i*60000).toISOString();o.updatedAt=new Date(Date.now()+i*60000).toISOString();
  db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o),reminderOrder);
  assert.equal((await call('/api/crm',{cookie:reminderActor.cookie})).status,200);
 }
 let reminderState=(await call('/api/crm',{cookie:reminderActor.cookie})).data;
 assert.equal(reminderState.reminders.length,20);
 const reminderId=reminderState.reminders[0].id;
 assert.equal((await call('/api/crm',{cookie:reminderActor.cookie,body:{action:'readReminder',id:reminderId}})).status,200);
 reminderState=(await call('/api/crm',{cookie:reminderActor.cookie})).data;
 assert.ok(reminderState.reminders[0].readAt);assert.equal(reminderState.reminders.length,20);
 const unreadId=reminderState.reminders[1].id;
 await call('/api/crm',{cookie:chief.cookie,body:{action:'readReminder',id:unreadId}});
 assert.equal((await call('/api/crm',{cookie:reminderActor.cookie})).data.reminders.find(r=>r.id===unreadId).readAt,undefined);
 db.prepare("UPDATE orders SET data=json_set(data,'$.due','','$.status','confirm') WHERE id=?").run(reminderOrder);
 reminderState=(await call('/api/crm',{cookie:reminderActor.cookie})).data;
 assert.equal(reminderState.reminders.length,20);assert.ok(reminderState.reminders.find(r=>r.id===reminderId).readAt);
 assert.ok(!(await call('/api/crm',{cookie:chief.cookie})).data.reminders.some(r=>r.id===reminderId));
 console.log('Reminders: latest 20, read persistence, rescheduled-call history and employee isolation passed.');
 // Routing settings are admin-only; previews reveal only the selected rule, never credentials.
 for(const slot of [1,2,4])db.prepare('INSERT OR REPLACE INTO settings(id,data) VALUES(?,?)').run('cdek-'+slot,JSON.stringify({name:slot===4?'ИП Аскеров':'Account '+slot,clientId:'private-client',clientSecret:'private-secret'}));
 const routePath='/api/cdek/routing';
 assert.equal((await call(routePath,{cookie:editor.cookie})).status,403);
 assert.equal((await call(routePath,{cookie:reminderActor.cookie})).status,403);
 assert.equal((await call(routePath,{cookie:editor.cookie,body:{enabled:true}})).status,403);
 let routeSettings=await call(routePath,{cookie:cookies.admin});assert.equal(routeSettings.status,200,routeSettings.text);assert.ok(!routeSettings.text.includes('private-'));
 const routeConfig={...routeSettings.data.config,enabled:true,rules:[{id:'product',name:'Main product',enabled:true,slot:2,from:'',to:'',departments:[],products:['Expensive'],weekdays:[],period:'week',maxCount:null,maxAmount:null}]};
 let routeSave=await call(routePath,{cookie:cookies.admin,body:routeConfig});assert.equal(routeSave.status,200,routeSave.text);
 assert.equal((await call(routePath,{cookie:cookies.admin,body:routeConfig})).status,400,'Stale settings cannot overwrite new rules');
 const routeOrderId=reminderOrder;
 for(const name of ['Cheap','Expensive']){db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('routing-'+name,name.toLowerCase(),JSON.stringify({name}));db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('routing-stock-'+name,'routing-'+name,200,'Fixture','admin',new Date().toISOString());}
 db.prepare("UPDATE orders SET data=json_set(data,'$.items',json(?)) WHERE id=?").run(JSON.stringify([{name:'Cheap',price:100,quantity:100},{name:'Expensive',price:200,quantity:1}]),routeOrderId);
 let preview=await call(routePath+'?orderId='+routeOrderId,{cookie:editor.cookie});assert.equal(preview.status,200,preview.text);assert.equal(preview.data.choice.slot,2);assert.ok(!preview.text.includes('private-'));assert.equal(preview.data.config,undefined);
 assert.equal((await call(routePath+'?orderId='+routeOrderId,{cookie:reminderActor.cookie})).status,403);
 db.prepare("UPDATE employees SET data=json_set(data,'$.department','5') WHERE id=?").run(reminderActor.e.id);
 preview=await call(routePath+'?orderId='+routeOrderId,{cookie:editor.cookie});assert.equal(preview.data.choice.slot,4);
 db.prepare("UPDATE employees SET data=json_set(data,'$.department','1') WHERE id=?").run(reminderActor.e.id);
 const capped={...routeSave.data.config,rules:routeSave.data.config.rules.map(r=>({...r,maxAmount:1}))};
 routeSave=await call(routePath,{cookie:cookies.admin,body:capped});assert.equal(routeSave.status,200);
 preview=await call(routePath+'?orderId='+routeOrderId,{cookie:editor.cookie});assert.equal(preview.status,400);assert.match(preview.data.error,/лимиты/);
 assert.equal((await call(routePath,{cookie:cookies.admin,body:{...routeSave.data.config,rules:[{...capped.rules[0],from:'2026-02-30'}]}})).status,400);
 console.log('CDEK routing HTTP: admin-only settings, stale saves, logistic preview, credentials privacy, expensive item, mandatory A_ and quota denial passed.');
 // Order settings: real API, stored stage deadlines, and editing enforcement.
 const policyPath='/api/order-settings';
 for(const cookie of [editor.cookie,reminderActor.cookie,chief.cookie]){
  assert.equal((await call(policyPath,{cookie})).status,403);
  assert.equal((await call(policyPath,{cookie,body:{}})).status,403);
 }
 let savedPolicy=(await call(policyPath,{cookie:cookies.admin})).data;
 assert.equal(savedPolicy.policy.reworkHours,96);assert.equal(savedPolicy.policy.finalHours,24);
 const originalPolicy=savedPolicy.policy;
 const stalePolicy={...savedPolicy};
 async function setPolicy(patch){const r=await call(policyPath,{cookie:cookies.admin,body:{revision:savedPolicy.revision,policy:{...savedPolicy.policy,...patch}}});assert.equal(r.status,200,r.text);savedPolicy=r.data;}
 await setPolicy({reworkHours:2,finalHours:3,operatorDraftEdit:false,operatorReworkEdit:false,logisticDetailsEdit:false});
 assert.equal((await call(policyPath,{cookie:cookies.admin,body:stalePolicy})).status,409);
 assert.equal((await call(policyPath,{cookie:cookies.admin,body:{...savedPolicy,policy:{...savedPolicy.policy,reworkHours:0}}})).status,400);
 const policyOperator=await fixture('policy-operator');records('policy-operator');
 const policyId='policy-operator-o-confirm';
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('policy-product','policy product',JSON.stringify({name:'Policy product'}));
 db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('policy-stock','policy-product',10,'Fixture','admin',new Date().toISOString());
 let policyOrder=JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(policyId).data);
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...policyOrder,address:'Test address 1',delivery:'cdek_courier',items:[{name:'Policy product',quantity:1,price:100}]}),policyId);
 async function policyAction(cookie,body,status=200){const version=db.prepare('SELECT version FROM orders WHERE id=?').get(body.id||policyId).version;const r=await call('/api/crm',{cookie,body:{id:policyId,version,...body}});assert.equal(r.status,status,r.text);return JSON.parse(db.prepare('SELECT data FROM orders WHERE id=?').get(body.id||policyId).data);}
 await policyAction(editor.cookie,{action:'updateOrder',address:'Changed'},400);
 await policyAction(editor.cookie,{action:'updateDelivery',delivery:'moscow_courier'},400);
 await policyAction(policyOperator.cookie,{action:'updateOrder',id:'policy-operator-o-draft',items:[]},400);
 policyOrder=await policyAction(editor.cookie,{action:'transition',to:'rework',reason:'Test'});
 assert.equal(policyOrder.reworkHours,2);assert.ok(Math.abs(Date.parse(policyOrder.reworkDeadline)-Date.now()-2*3600000)<10000);
 await policyAction(policyOperator.cookie,{action:'updateOrder',items:policyOrder.items},400);
 const frozenDeadline=policyOrder.reworkDeadline;
 await setPolicy({reworkHours:null,finalHours:null});
 let policyState=(await call('/api/crm',{cookie:cookies.admin})).data;
 assert.equal(policyState.orders.find(o=>o.id===policyId).reworkDeadline,frozenDeadline);
 policyOrder=await policyAction(policyOperator.cookie,{action:'transition',to:'confirm',reason:'Test',finalHandoffConfirmed:true});assert.equal(policyOrder.finalConfirmHours,null);assert.equal(policyOrder.noAnswerDeadline,undefined);
 assert.equal((await call('/api/crm',{cookie:cookies.admin})).data.orders.find(o=>o.id===policyId).noAnswerDeadline,undefined);
 await policyAction(editor.cookie,{action:'transition',to:'rework',reason:'Test'},400);
 await policyAction(editor.cookie,{action:'transition',to:'check',reason:'Test'});
 await policyAction(cookies.admin,{action:'transition',to:'extra',reason:'Test'});
 policyOrder=await policyAction(editor.cookie,{action:'transition',to:'rework',reason:'Test'});assert.equal(policyOrder.reworkHours,null);assert.equal(policyOrder.reworkDeadline,undefined);
 await setPolicy({...originalPolicy,finalHours:3});
 assert.equal((await call('/api/crm',{cookie:cookies.admin})).data.orders.find(o=>o.id===policyId).reworkDeadline,undefined);
 policyOrder=await policyAction(policyOperator.cookie,{action:'updateOrder',items:policyOrder.items,address:'Updated address'});assert.equal(policyOrder.address,'Updated address');
 policyOrder=await policyAction(policyOperator.cookie,{action:'transition',to:'extra',reason:'Test',finalHandoffConfirmed:true});assert.equal(policyOrder.finalConfirmHours,3);assert.ok(Math.abs(Date.parse(policyOrder.noAnswerDeadline)-Date.now()-3*3600000)<10000);
 const frozenFinal=policyOrder.noAnswerDeadline;await setPolicy({finalHours:1});
 assert.equal((await call('/api/crm',{cookie:cookies.admin})).data.orders.find(o=>o.id===policyId).noAnswerDeadline,frozenFinal);
 db.prepare("UPDATE orders SET data=json_set(data,'$.finalHandoffAt',?) WHERE id=?").run(new Date(Date.now()-4*3600000).toISOString(),policyId);
 assert.equal((await call('/api/crm',{cookie:cookies.admin})).data.orders.find(o=>o.id===policyId).status,'refused');
 console.log('Order settings HTTP: admin access, stale writes, edit restrictions, custom and disabled timers, frozen deadlines and automatic cancellation passed.');

 const baseOverview=await call('/api/base',{cookie:cookies.admin});assert.equal(baseOverview.status,200,baseOverview.text);assert.ok(baseOverview.data.config.M.sheets.some(s=>s.name==='П'));assert.equal('clients' in baseOverview.data,false);
 assert.equal((await call('/api/base',{cookie:policyOperator.cookie})).status,403);
 const baseImport={action:'import',base:'J',filename:'test.xlsx',revision:baseOverview.data.revision,session:crypto.randomUUID(),rows:[{row:2,name:'Import test',phone:'8 (999) 123-98-76',linkedPhones:['79991239875'],fields:{custom:'preserved'}}]};
 let imported=await call('/api/base',{cookie:cookies.admin,body:baseImport});assert.equal(imported.status,200,imported.text);assert.equal(imported.data.added,1);assert.equal(imported.data.applied,false);
 imported=await call('/api/base',{cookie:cookies.admin,body:{...baseImport,apply:true}});assert.equal(imported.status,200,imported.text);assert.equal(imported.data.applied,true);assert.ok(imported.data.backupId);
 assert.ok(db.prepare('SELECT COUNT(*) AS n FROM base_import_snapshots WHERE session=?').get(baseImport.session).n>0);
 imported=await call('/api/base',{cookie:cookies.admin,body:{...baseImport,apply:true}});assert.equal(imported.data.added,1,'Retry must return the original result');
 imported=await call('/api/base',{cookie:cookies.admin,body:{...baseImport,session:crypto.randomUUID(),apply:true}});assert.equal(imported.data.skipped,1);
 let conflict=await call('/api/base',{cookie:cookies.admin,body:{...baseImport,base:'M'}});assert.equal(conflict.data.conflicts.length,1);
 const importedId=conflict.data.conflicts[0].clientId;assert.equal((await call('/api/crm',{cookie:cookies.admin})).data.clients.some(c=>c.id===importedId),false,'Free database records must not enter the CRM card payload');
 const denied=await call('/api/base',{cookie:cookies.admin,body:{action:'dispatch',base:'J',sheet:'К',project:'1',count:1}});assert.equal(denied.status,400);
 const baseAssigned=await call('/api/base',{cookie:cookies.admin,body:{action:'assign',base:'J',sheet:'Т1',operator:'one',count:1}});assert.equal(baseAssigned.status,200,baseAssigned.text);assert.equal(baseAssigned.data.assigned,1);
 console.log('Base HTTP: aggregate response, admin guard, Excel import preview/apply/backup/duplicates, cross-base conflicts, no free cards, blocked dispatch and manual assignment passed.');
 // Manual creation uses the selected base and its configured entry sheet.
 const manualBase=await call('/api/base',{cookie:cookies.admin});
 const config=manualBase.data.config;config.J.importSheet='Ж1';config.J.sheets.push({...config.J.sheets.find(s=>s.name==='Т1'),name:'Ж1'});
 const manualConfig=await call('/api/base',{cookie:cookies.admin,body:{config,revision:manualBase.data.revision}});assert.equal(manualConfig.status,200,manualConfig.text);
 const manualClient={name:'Manual client',phone:'+79991237701',owner:'',source:'Вручную'};
 for(const [baseType,phone,sheet] of [['J','+79991237701','Ж1'],['M','+79991237702','Т1']]){
  const created=await call('/api/crm',{cookie:cookies.admin,body:{action:'createClient',baseType,client:{...manualClient,phone}}});assert.equal(created.status,200,created.text);
  const c=JSON.parse(db.prepare('SELECT data FROM clients WHERE phone=?').get(phone).data);assert.equal(c.baseType,baseType);assert.equal(c.sheet,sheet);assert.equal(c.owner,'');assert.ok(!c.distributedAt);
 }
 const manualOverview=await call('/api/base',{cookie:cookies.admin});assert.equal(manualOverview.data.summary.J['Ж1'].total,1);
 const duplicateManual=await call('/api/crm',{cookie:cookies.admin,body:{action:'createClient',baseType:'M',client:manualClient}});assert.equal(duplicateManual.status,400,duplicateManual.text);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clients WHERE phone=?').get(manualClient.phone).n,1);assert.equal(JSON.parse(db.prepare('SELECT data FROM clients WHERE phone=?').get(manualClient.phone).data).baseType,'J');
 assert.equal((await call('/api/crm',{cookie:cookies.admin,body:{action:'createClient',baseType:'unknown',client:{...manualClient,phone:'+79991237703'}}})).status,400);
 assert.equal((await call('/api/crm',{cookie:policyOperator.cookie,body:{action:'createClient',client:{...manualClient,phone:'+79991237703'}}})).status,400);
 const headClient=await call('/api/crm',{cookie:cookies.head,body:{action:'createClient',client:{...manualClient,phone:'+79991237703',owner:'one'}}});assert.equal(headClient.status,200,headClient.text);
 const headAdded=JSON.parse(db.prepare('SELECT data FROM clients WHERE phone=?').get('+79991237703').data);assert.equal(headAdded.baseType,'M');assert.equal(headAdded.sheet,'К');assert.equal(headAdded.owner,'one');assert.ok(Math.abs(Date.parse(headAdded.trialUntil)-Date.now()-86400000)<10000);
 console.log('Manual client HTTP: admin M/J creation, configured entry sheet, counts, duplicate protection, invalid base, role guards and head assignment passed.');
 console.log('HTTP auth passed: login, refresh, scopes, actor spoofing, CSRF, account creation/reset/disable, session revocation, logout and rate limiting.');
}catch(e){console.error(logs);throw e;}finally{if(server){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

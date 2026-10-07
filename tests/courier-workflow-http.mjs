// Full API flow against temporary data; never uses the live CRM or carrier services.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {inventorySQL} from '../lib/inventory-sql.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
import {courierBalance,courierReminderNeedsAction} from '../lib/courier.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-courier-')),db=new DatabaseSync(join(dir,'test.sqlite')),origin='https://crm.test',port='3098',base='http://127.0.0.1:'+port,password='synthetic-password-123';
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of [...authSchema,...inventorySQL])db.exec(sql);
 const hash=await hashPassword(password),cookies={};
 for(const [id,role] of [['admin','admin'],['operator','operator'],['logistic','logistic'],['second','logistic'],['chief','chief_logistic'],['courier','courier'],['stranger','courier']]){
  const e={id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department:['admin','operator'].includes(role)?'1':undefined,salary:0,bonus:0,version:1};db.prepare('INSERT INTO employees VALUES(?,?,1)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare("INSERT INTO settings VALUES('main',?)").run(JSON.stringify({retentionDays:35}));
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('p','product',JSON.stringify({id:'p',name:'Product'}));db.prepare("INSERT INTO stock_movements VALUES('initial','p',100,'test','admin',?)").run(new Date().toISOString());
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(actor,path='/api/crm',body,expected=200){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[actor]?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return {data,headers:response.headers};}
 for(const id of ['admin','operator','logistic','second','chief','courier','stranger']){const r=await call(id,'/api/auth/login',{login:id,password});cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 const order=id=>{const r=db.prepare('SELECT data,version FROM orders WHERE id=?').get(id);return {...JSON.parse(r.data),version:r.version};};
 const stock=()=>db.prepare("SELECT available FROM product_stock WHERE id='p'").get().available;
 const hours=n=>new Date(Date.now()+n*3600000).toISOString();
 let count=0;
 async function create(){
  const r=await call('admin','/api/crm',{action:'createClient',baseType:'M',client:{name:'Test client '+(++count),phone:'+79990000'+String(count).padStart(3,'0'),city:'Москва',address:'Москва, Тверская, дом 1',owner:'operator',source:'Synthetic'}});
  const c=r.data.state.clients.find(c=>c.name==='Test client '+count);
  const created=await call('operator','/api/crm',{action:'createOrder',clientId:c.id,delivery:'moscow_courier',items:[{name:'Product',quantity:1,price:10000}],addressConfirmed:true});
  const o=created.data.state.orders.find(o=>o.clientId===c.id);assert.equal(o.status,'draft');return o.id;
 }
 async function act(id,actor,body,expected=200){const result=await call(actor,'/api/crm',{id,version:order(id).version,...body},expected);return result.data;}
 async function assembled(id){await act(id,'operator',{action:'transition',to:'confirm'});await act(id,'logistic',{action:'transition',to:'extra'},400);await act(id,'logistic',{action:'transition',to:'refused',reason:'No'},400);await act(id,'logistic',{action:'transition',to:'packing'});await act(id,'logistic',{action:'transition',to:'shipping',courierId:'courier'},400);await act(id,'logistic',{action:'markPackingWaybill'});await act(id,'logistic',{action:'transition',to:'shipping',courierId:'courier'});assert.equal(order(id).status,'packing');assert.equal(order(id).shippedAt,undefined);}
 const id=await create();await assembled(id);const before=stock();
 await act(id,'courier',{action:'courierWorkflow',operation:'confirm'},400);
 await act(id,'stranger',{action:'courierAccept',confirmed:true},400);
 await act(id,'courier',{action:'courierAccept',confirmed:true});assert.equal(order(id).courier.phase,'confirmation');
 await act(id,'courier',{action:'contact',contact:'missed',reason:'No answer'},400);
 await act(id,'courier',{action:'contact',contact:'missed',reason:'No answer',due:hours(24)},400);
 await act(id,'courier',{action:'contact',contact:'missed',reason:'No answer',due:hours(-1)},400);
 const nextMinute=new Date(Math.ceil((Date.now()+60000)/60000)*60000).toISOString();
 if(new Date(Date.parse(nextMinute)+3*3600000).toISOString().slice(0,10)===new Date(Date.now()+3*3600000).toISOString().slice(0,10)){
  const r=await act(id,'courier',{action:'contact',contact:'missed',reason:'No answer',due:nextMinute});
  assert.equal(order(id).due,nextMinute);const reminder=r.state.reminders.find(r=>r.kind==='call'&&r.orderId===id);
  assert.ok(reminder);await call('courier','/api/crm',{action:'readReminder',id:reminder.id});
  const saved=(await call('courier')).data.reminders.find(r=>r.id===reminder.id);assert.ok(saved.readAt);assert.equal(courierReminderNeedsAction(saved,order(id)),true);
 }
 await act(id,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true},400);
 await act(id,'logistic',{action:'contact',contact:'missed',reason:'Test'},400);
 await act(id,'courier',{action:'contact',contact:'callback',reason:'Later',due:hours(49)},400);
 await act(id,'courier',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
 for(const operation of ['toLogistic','requestPostpone','approvePostpone','rejectPostpone'])await act(id,'courier',{action:'courierWorkflow',operation,reason:'Test',at:hours(200)},400);
 await act(id,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'Недозвон'});
 assert.equal(order(id).courier.phase,'operator');assert.equal(order(id).status,'rework');assert.equal(order(id).noAnswerDeadline,undefined);assert.equal(order(id).contactAuthor,undefined);assert.equal(stock(),before);
 await act(id,'operator',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
 assert.ok((await call('operator')).data.reminders.some(r=>r.kind==='call'&&r.orderId===id&&!r.resolved));
 for(const employee of ['logistic','second','chief']){
  await act(id,employee,{action:'contact',contact:'callback',reason:'Later',due:hours(1)},400);
  await act(id,employee,{action:'courierWorkflow',operation:'confirm'},400);
  assert.ok(!(await call(employee)).data.reminders.some(r=>r.kind==='call'&&r.orderId===id&&!r.resolved));
 }
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});assert.equal(order(id).courier.phase,'resume');
 await act(id,'courier',{action:'courierAccept',confirmed:true},400);
 await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'Questions at door'});assert.equal(order(id).status,'rework');assert.equal(order(id).courier.atDoor,true);
 assert.ok((await call('operator')).data.reminders.some(r=>r.orderId===id&&r.title.includes('Отказ у курьера')));
 const working=order(id);working.courier.operatorStartedAt=hours(-2);working.reworkDeadline=hours(94);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(working),id);
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});assert.ok(Math.abs(order(id).courier.operatorBudgetMs-94*3600000)<10000);
 const remaining=order(id).courier.operatorBudgetMs;
 await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'One more question'});assert.equal(order(id).courier.operatorBudgetMs,remaining);
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});assert.equal(stock(),before);
 await act(id,'logistic',{action:'receivePayment'});await act(id,'logistic',{action:'receivePayment'},400);
 assert.equal(db.prepare('SELECT amount FROM cash_operations WHERE order_id=?').get(id).amount,1000000);
 // Editable price/address while operator works: custody follows amount, physical contents stay locked.
 const editId=await create();await assembled(editId);await act(editId,'courier',{action:'courierAccept',confirmed:true});await act(editId,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'Change order'});
 const editStock=stock(),editableVersion=order(editId).version;
 const edit={action:'updateOrder',items:[{name:'Product',quantity:1,price:9000}],address:'Москва, Тверская, дом 2',comment:'New price and address',addressConfirmed:true};
 await act(editId,'operator',edit);assert.equal(order(editId).courier.amount,9000);assert.equal(courierBalance([order(editId)],'courier').parcels,9000);assert.equal(stock(),editStock);
 assert.equal(JSON.parse(db.prepare('SELECT data FROM clients WHERE id=?').get(order(editId).clientId).data).address,edit.address);
 assert.ok((await call('courier')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('9000')));
 await act(editId,'operator',{...edit,version:editableVersion},400);
 await act(editId,'operator',{...edit,items:[{name:'Product',quantity:2,price:9000}]},400);
 await act(editId,'operator',{...edit,delivery:'russian_post'},400);
 await act(editId,'logistic',edit,400);
 await act(editId,'operator',{action:'courierWorkflow',operation:'requestRepack',reason:'Add one more item'});
 for(const e of ['logistic','second','chief'])assert.ok((await call(e)).data.reminders.some(r=>r.orderId===editId&&r.title.includes('запросил пересборку')));
 await act(editId,'operator',{action:'courierWorkflow',operation:'confirm'},400);
 await act(editId,'courier',{action:'courierWorkflow',operation:'recall',reason:'Invalid'},400);
 await act(editId,'logistic',{action:'courierWorkflow',operation:'recall',reason:'Add one more item'});
 const recallBudget=order(editId).courier.operatorBudgetMs;assert.equal(order(editId).courier.phase,'recall');assert.equal(stock(),editStock);
 await act(editId,'operator',edit,400);await act(editId,'logistic',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true},400);
 await act(editId,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true},400);
 await act(editId,'courier',{action:'courierWorkflow',operation:'returnRecall'},400);
 await act(editId,'courier',{action:'courierWorkflow',operation:'returnRecall',confirmed:true});
 assert.equal(order(editId).courier.phase,'recall_returned');assert.equal(courierBalance([order(editId)],'courier').parcels,9000);assert.equal(stock(),editStock);
 await act(editId,'logistic',{action:'markPackingWaybill'},400);
 await act(editId,'chief',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true});
 assert.equal(order(editId).courier,undefined);assert.equal(order(editId).status,'packing');assert.equal(order(editId).packingWaybillAt,undefined);assert.equal(stock(),editStock);assert.equal(courierBalance([order(editId)],'courier').parcels,0);
 assert.ok((await call('operator')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('принял отозванную')));
 await act(editId,'chief',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true},400);
 await act(editId,'logistic',{action:'markPackingWaybill'},400);
 await act(editId,'operator',{...edit,items:[{name:'Product',quantity:2,price:9000}]});assert.equal(stock(),editStock-1);assert.ok(order(editId).courierRepackRequest.completedAt);
 assert.ok((await call('logistic')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('правки для пересборки сохранены')));
 await act(editId,'logistic',{action:'markPackingWaybill'});
 await act(editId,'operator',edit,400);
 await act(editId,'logistic',{action:'transition',to:'shipping',courierId:'courier'});assert.equal(order(editId).courier.amount,18000);assert.equal(order(editId).courier.operatorBudgetMs,recallBudget);
 await act(editId,'courier',{action:'courierAccept',confirmed:true});assert.equal(order(editId).courier.phase,'confirmation');
 await act(editId,'courier',{action:'courierWorkflow',operation:'confirm'});await act(editId,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});
 await act(editId,'operator',edit,400);await act(editId,'admin',edit,400);await act(editId,'logistic',{action:'receivePayment'});assert.equal(db.prepare('SELECT amount FROM cash_operations WHERE order_id=?').get(editId).amount,1800000);
 // Before physical acceptance, recall immediately resets to assembly and an obsolete courier click cannot win.
 const pendingId=await create();await assembled(pendingId);const pendingVersion=order(pendingId).version;
 await act(pendingId,'logistic',{action:'courierWorkflow',operation:'recall',reason:'Wrong handoff'});assert.equal(order(pendingId).courier,undefined);assert.equal(order(pendingId).packingWaybillAt,undefined);
 await act(pendingId,'courier',{action:'courierAccept',confirmed:true,version:pendingVersion},400);
 // Logistics extra confirmation is dropped only on a switch to Moscow, not on the first confirmation.
 for(const from of ['russian_post','cdek_pickup']){
  const switchId=await create();await act(switchId,'operator',{action:'updateOrder',delivery:from,items:order(switchId).items,addressConfirmed:true});await act(switchId,'operator',{action:'transition',to:'confirm'});
  if(from==='russian_post')await act(switchId,'logistic',{action:'transition',to:'extra'});else{await act(switchId,'logistic',{action:'transition',to:'check'});await act(switchId,'admin',{action:'transition',to:'extra'});}
  await act(switchId,'logistic',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
  const action=from==='russian_post'?{action:'updateDelivery',delivery:'moscow_courier'}:{action:'updateOrder',delivery:'moscow_courier',addressConfirmed:true};
  await act(switchId,'logistic',action);const switched=order(switchId);assert.equal(switched.status,'packing');assert.equal(switched.extra,false);assert.equal(switched.due,'');assert.equal(switched.noAnswerDeadline,undefined);assert.equal(switched.confirmationStartedAt,undefined);assert.equal(switched.packingWaybillAt,undefined);assert.equal(switched.deliveryChange.to,'moscow_courier');
  await act(switchId,'logistic',{action:'markPackingWaybill'});await act(switchId,'logistic',{action:'transition',to:'shipping',courierId:'courier'});await act(switchId,'courier',{action:'courierAccept',confirmed:true});assert.equal(order(switchId).courier.phase,'confirmation');
 }
 const firstId=await create();await act(firstId,'operator',{action:'updateOrder',delivery:'russian_post',items:order(firstId).items,addressConfirmed:true});await act(firstId,'operator',{action:'transition',to:'confirm'});await act(firstId,'logistic',{action:'updateDelivery',delivery:'moscow_courier'});assert.equal(order(firstId).status,'confirm');
 console.log('Courier recall/repack, guarded editing, stale clicks, custody, price/stock/cash and delivery-switch regressions passed.');
 // An existing pending logistic request is transferred to the operator without another physical acceptance.
 const legacyId=await create();await assembled(legacyId);await act(legacyId,'courier',{action:'courierAccept',confirmed:true});
 const legacy=order(legacyId),legacyStock=stock();legacy.courier.phase='logistic';legacy.courier.workHours=null;legacy.courier.operatorBudgetMs=4*3600000;legacy.courier.postponement={state:'pending',at:hours(200),reason:'Old request',requestedAt:hours(-1)};
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(legacy),legacyId);
 const migratedState=(await call('operator')).data,migrated=order(legacyId);
 assert.equal(migrated.status,'rework');assert.equal(migrated.courier.phase,'operator');assert.equal(migrated.courier.postponement.state,'rejected');assert.equal(migrated.courier.operatorBudgetMs,4*3600000);assert.equal(stock(),legacyStock);
 assert.ok(migratedState.reminders.some(r=>r.orderId===legacyId&&r.title.includes('Заказ передан оператору')));
 await call('operator');assert.equal(order(legacyId).version,migrated.version);
 await act(legacyId,'operator',{action:'courierWorkflow',operation:'confirm'});await act(legacyId,'courier',{action:'courierWorkflow',operation:'resume'});
 // Expired confirmation returns work, expired shared budget cancels sale but keeps the parcel reserved.
 const returnedId=await create();await assembled(returnedId);await act(returnedId,'courier',{action:'courierAccept',confirmed:true});
 const accepted=order(returnedId);accepted.courier.workStartedAt=hours(-49);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(accepted),returnedId);await call('operator');assert.equal(order(returnedId).status,'rework');
 const reserved=stock(),rework=order(returnedId);rework.reworkDeadline=hours(-1);rework.courier.operatorStartedAt=hours(-97);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(rework),returnedId);await call('courier');assert.equal(order(returnedId).status,'refused');assert.equal(stock(),reserved);
 await act(returnedId,'courier',{action:'returnToWarehouse'},403);await act(returnedId,'logistic',{action:'returnToWarehouse'});assert.equal(stock(),reserved+1);await act(returnedId,'logistic',{action:'returnToWarehouse'},400);
 const pendingIds=[];
 for(let i=0;i<22;i++){const newId=await create();await assembled(newId);pendingIds.push(newId);}
 function courierNotices(state){return {active:state.reminders.filter(r=>courierReminderNeedsAction(r,state.orders.find(o=>o.id===r.orderId))),history:state.reminders.filter(r=>!courierReminderNeedsAction(r,state.orders.find(o=>o.id===r.orderId)))};}
 let noticeState=(await call('courier')).data,notices=courierNotices(noticeState);
 for(const newId of pendingIds)assert.ok(notices.active.some(r=>r.orderId===newId));assert.ok(notices.active.length>=22);assert.ok(notices.history.length<=20);
 const oldest=notices.active.find(r=>r.orderId===pendingIds[0]);await call('courier','/api/crm',{action:'readReminder',id:oldest.id});assert.ok(courierNotices((await call('courier')).data).active.some(r=>r.id===oldest.id&&r.readAt));
 db.prepare("DELETE FROM reminders WHERE employee_id='courier' AND json_extract(data,'$.orderId')=?").run(pendingIds[0]);
 notices=courierNotices((await call('courier')).data);assert.ok(notices.active.some(r=>r.orderId===pendingIds[0]),'Restore missing active task');
 await act(pendingIds[0],'courier',{action:'courierAccept',confirmed:true});notices=courierNotices((await call('courier')).data);assert.ok(!notices.active.some(r=>r.orderId===pendingIds[0]));assert.ok(notices.history.length<=20);
 for(const newId of pendingIds){if(!order(newId).courier.acceptedAt)await act(newId,'courier',{action:'courierAccept',confirmed:true});await act(newId,'courier',{action:'contact',contact:'callback',reason:'Scheduled test call',due:hours(1)});}
 notices=courierNotices((await call('courier')).data);for(const newId of pendingIds)assert.ok(notices.active.some(r=>r.kind==='call'&&r.orderId===newId));assert.ok(notices.history.length<=20);
 console.log('All active courier tasks persist, viewed tasks stay actionable, missing tasks recover, completed history limited to 20.');
 console.log('Moscow API: real create/handoff/accept, operator-only returns, forbidden retired actions, operator calls, shared budget and legacy migration, money, expiry, physical return and stock passed.');
}finally{if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}db.close();rmSync(dir,{recursive:true,force:true});}

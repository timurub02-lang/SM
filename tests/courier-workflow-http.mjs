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
 for(const [id,role] of [['admin','admin'],['operator','operator'],['logistic','logistic'],['second','logistic'],['chief','chief_logistic'],['courier','courier'],['stranger','courier'],['head','department_head'],['foreign-head','department_head']]){
  const e={id,login:id,name:'Test '+id,alias:'',skLogin:'',role,department:role==='department_head'?(id==='head'?'1':'2'):['admin','operator'].includes(role)?'1':undefined,salary:0,bonus:0,version:1};db.prepare('INSERT INTO employees VALUES(?,?,1)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare("INSERT INTO settings VALUES('main',?)").run(JSON.stringify({retentionDays:35}));
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('p','product',JSON.stringify({id:'p',name:'Product'}));db.prepare("INSERT INTO stock_movements VALUES('initial','p',100,'test','admin',?)").run(new Date().toISOString());
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(actor,path='/api/crm',body,expected=200){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[actor]?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return {data,headers:response.headers};}
 for(const id of ['admin','operator','logistic','second','chief','courier','stranger','head','foreign-head']){const r=await call(id,'/api/auth/login',{login:id,password});cookies[id]=r.headers.get('set-cookie').split(';')[0];}
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
 async function receipt(id,title,amount,{visible=true,read=true}={}){
  const state=(await call('courier')).data,notices=state.reminders.filter(r=>r.kind==='courier-receipt'&&r.orderId===id);
  assert.equal(notices.length,1,'Receipt is delivered exactly once');const notice=notices[0];
  assert.equal(notice.title,title);assert.ok(notice.text.includes(amount+' ₽'));assert.ok(notice.text.includes('Test '));
  assert.equal(state.orders.some(o=>o.id===id),visible);assert.equal(courierReminderNeedsAction(notice,state.orders.find(o=>o.id===id)),false);
  assert.ok(!state.tasks.some(t=>t.orderId===id),"Completed receipt must not create a task");
  assert.ok(!(await call('stranger')).data.reminders.some(r=>r.id===notice.id));
  if(read){await call('courier','/api/crm',{action:'readReminder',id:notice.id});const seen=(await call('courier')).data.reminders.find(r=>r.id===notice.id);assert.ok(seen.readAt);assert.equal(courierReminderNeedsAction(seen,order(id)),false);}
  return notice.id;
 }
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
 assert.equal(order(id).courier.phase,'operator');assert.equal(order(id).status,'rework');assert.equal(order(id).noAnswerDeadline,undefined);
 const inbox=(await call('operator')).data;assert.equal(inbox.tasks.filter(t=>t.orderId===id).length,1);
 await call('operator','/api/crm',{action:'readReminder',id:inbox.tasks.find(t=>t.orderId===id).id});
 assert.equal((await call('operator')).data.tasks.filter(t=>t.orderId===id).length,1,'Viewing a task does not complete it');
 assert.equal((await call('head')).data.tasks.filter(t=>t.orderId===id).length,1);
 assert.equal((await call('foreign-head')).data.tasks.filter(t=>t.orderId===id).length,0);assert.equal(order(id).contactAuthor,undefined);assert.equal(stock(),before);
 await act(id,'operator',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
 assert.ok((await call('operator')).data.reminders.some(r=>r.kind==='call'&&r.orderId===id&&!r.resolved));
 for(const employee of ['logistic','second','chief']){
  await act(id,employee,{action:'contact',contact:'callback',reason:'Later',due:hours(1)},400);
  await act(id,employee,{action:'courierWorkflow',operation:'confirm'},400);
  assert.ok(!(await call(employee)).data.reminders.some(r=>r.kind==='call'&&r.orderId===id&&!r.resolved));
 }
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});assert.equal(order(id).courier.phase,'resume');assert.ok(!(await call('operator')).data.tasks.some(t=>t.orderId===id),'Handoff completes the operator task');
 await act(id,'courier',{action:'courierAccept',confirmed:true},400);
 await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'Questions during delivery'});assert.equal(order(id).status,'rework');assert.equal(order(id).courier.atDoor,false);
 assert.ok((await call('operator')).data.reminders.some(r=>r.orderId===id&&r.title.includes('Возврат с доставки')));
 const working=order(id);working.courier.operatorStartedAt=hours(-2);working.reworkDeadline=hours(94);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(working),id);
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});assert.ok(Math.abs(order(id).courier.operatorBudgetMs-94*3600000)<10000);
 const remaining=order(id).courier.operatorBudgetMs;
 await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierWorkflow',operation:'toOperator',reason:'One more question'});assert.equal(order(id).courier.operatorBudgetMs,remaining);
 await act(id,'operator',{action:'courierWorkflow',operation:'confirm'});await act(id,'courier',{action:'courierWorkflow',operation:'resume'});
 await act(id,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});assert.equal(stock(),before);
 await act(id,'logistic',{action:'receivePayment'});await act(id,'logistic',{action:'receivePayment'},400);
 const moneyReceipt=await receipt(id,'Деньги приняты логистом',10000,{read:false});
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
 await act(editId,'logistic',{action:'transition',to:'rework',reason:'Client refuses'},400);
 await act(editId,'logistic',{action:'markPackingWaybill'},400);
 await act(editId,'chief',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true});
 assert.equal(order(editId).courier,undefined);assert.equal(order(editId).status,'packing');assert.equal(order(editId).packingWaybillAt,undefined);assert.equal(stock(),editStock);assert.equal(courierBalance([order(editId)],'courier').parcels,0);
 assert.ok((await call('operator')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('принял отозванную')));
 await act(editId,'chief',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true},400);
 await receipt(editId,'Посылка принята на пересборку',9000,{visible:false});
 await act(editId,'courier',{action:'courierAccept',confirmed:true},400);
 await act(editId,'logistic',{action:'transition',to:'rework'},400);
 await act(editId,'logistic',{action:'transition',to:'rework',reason:'Клиент отказывается'});
 assert.equal(order(editId).status,'rework');assert.equal(stock(),editStock);assert.equal(order(editId).courierRecall.operatorBudgetMs,recallBudget);
 assert.ok((await call('operator')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('После пересборки')));
 await act(editId,'logistic',{action:'transition',to:'packing'},400);
 await act(editId,'operator',{action:'transition',to:'confirm',finalHandoffConfirmed:true},400);
 await act(editId,'operator',{action:'transition',to:'packing'},400);
 await act(editId,'operator',{action:'contact',contact:'callback',reason:'Discuss refusal',due:hours(1)});
 await act(editId,'logistic',{action:'contact',contact:'callback',reason:'Wrong owner',due:hours(1)},400);
 await act(editId,'logistic',{action:'markPackingWaybill'},400);
 await act(editId,'operator',{...edit,items:[{name:'Product',quantity:2,price:9000}]});assert.equal(stock(),editStock-1);assert.ok(order(editId).courierRepackRequest.completedAt);
 assert.ok((await call('logistic')).data.reminders.some(r=>r.orderId===editId&&r.title.includes('правки для пересборки сохранены')));
 const afterRework=order(editId);afterRework.courierRecall.operatorStartedAt=hours(-2);afterRework.reworkDeadline=new Date(Date.now()+recallBudget-2*3600000).toISOString();db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(afterRework),editId);
 await act(editId,'operator',{action:'transition',to:'packing'});
 const repackedBudget=order(editId).courierRecall.operatorBudgetMs;assert.ok(Math.abs(repackedBudget-(recallBudget-2*3600000))<10000);assert.equal(order(editId).reworkDeadline,undefined);assert.equal(order(editId).packingWaybillAt,undefined);
 await act(editId,'logistic',{action:'markPackingWaybill'});
 await act(editId,'operator',edit,400);
 await act(editId,'logistic',{action:'transition',to:'shipping',courierId:'courier'});assert.equal(order(editId).courier.amount,18000);assert.equal(order(editId).courier.operatorBudgetMs,repackedBudget);
 await act(editId,'courier',{action:'courierAccept',confirmed:true});assert.equal(order(editId).courier.phase,'confirmation');
 await act(editId,'courier',{action:'courierWorkflow',operation:'confirm'});await act(editId,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});
 await act(editId,'operator',edit,400);await act(editId,'admin',edit,400);await act(editId,'logistic',{action:'receivePayment'});assert.equal(db.prepare('SELECT amount FROM cash_operations WHERE order_id=?').get(editId).amount,1800000);
 // Before physical acceptance, recall immediately resets to assembly and an obsolete courier click cannot win.
 const pendingId=await create();await assembled(pendingId);const pendingVersion=order(pendingId).version;
 await act(pendingId,'logistic',{action:'courierWorkflow',operation:'recall',reason:'Wrong handoff'});assert.equal(order(pendingId).courier,undefined);assert.equal(order(pendingId).packingWaybillAt,undefined);
 await act(pendingId,'courier',{action:'courierAccept',confirmed:true,version:pendingVersion},400);
 await act(pendingId,'logistic',{action:'transition',to:'rework',reason:'Not physically recalled'},400);
 // At the warehouse, cancellation and expiry release stock once without another courier receipt.
 for(const expire of [false,true]){
  const cancelledId=await create();await assembled(cancelledId);await act(cancelledId,'courier',{action:'courierAccept',confirmed:true});
  await act(cancelledId,'logistic',{action:'courierWorkflow',operation:'recall',reason:'Repack'});await act(cancelledId,'courier',{action:'courierWorkflow',operation:'returnRecall',confirmed:true});await act(cancelledId,'logistic',{action:'courierWorkflow',operation:'receiveRecall',confirmed:true});
  await act(cancelledId,'chief',{action:'transition',to:'rework',reason:'Client refuses'});const reservedStock=stock();
  if(expire){const expired=order(cancelledId);expired.reworkDeadline=hours(-1);expired.courierRecall.operatorStartedAt=hours(-97);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(expired),cancelledId);await call('operator');}
  else await act(cancelledId,'operator',{action:'transition',to:'refused',reason:'Client confirmed refusal'});
  assert.equal(order(cancelledId).status,'refused');assert.equal(stock(),reservedStock+1);assert.equal(courierBalance([order(cancelledId)],'courier').total,0);
  await act(cancelledId,'operator',{action:'transition',to:'refused',reason:'Duplicate'},400);await act(cancelledId,'logistic',{action:'returnToWarehouse'},400);await call('operator');assert.equal(stock(),reservedStock+1);
 }
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
 await receipt(returnedId,'Возврат принят на склад',10000);
 // Explicit doorstep refusal: two human decisions, no timer-driven cancellation.
 for(const result of ['deliver','return']){
  const doorId=await create();await assembled(doorId);
  await act(doorId,'courier',{action:'courierAccept',confirmed:true});
  await act(doorId,'courier',{action:'courierWorkflow',operation:'doorRefusal',reason:'Клиент отказывается',confirmed:true},400);
  await act(doorId,'courier',{action:'courierWorkflow',operation:'confirm'});
  await act(doorId,'courier',{action:'courierWorkflow',operation:'doorRefusal',reason:'Клиент отказывается'},400);
  await act(doorId,'courier',{action:'courierWorkflow',operation:'doorRefusal',reason:'Клиент отказывается',confirmed:true});
  const reserve=stock(),opened=order(doorId),door=opened.courier.doorRefusal;
  assert.equal(opened.status,'rework');assert.equal(opened.courier.atDoor,true);
  assert.equal(Date.parse(door.claimDueAt)-Date.parse(door.at),120000);assert.equal(Date.parse(door.decisionDueAt)-Date.parse(door.at),600000);
  for(const who of ['operator','head','admin','courier'])assert.ok((await call(who)).data.reminders.some(r=>r.kind==='courier-door'&&r.orderId===doorId&&!r.resolved));
  for(const who of ['foreign-head','stranger','logistic'])assert.ok(!(await call(who)).data.reminders.some(r=>r.kind==='courier-door'&&r.orderId===doorId));
  await act(doorId,'foreign-head',{action:'courierWorkflow',operation:'claimDoor'},400);
  await act(doorId,'head',{action:'updateOrder',comment:'Not an edit permission'},400);
  await act(doorId,'operator',{action:'courierWorkflow',operation:'resolveDoor',result,confirmed:true},400);
  for(const body of [{action:'contact',contact:'missed',reason:'No answer'},{action:'contact',contact:'callback',reason:'Later',due:hours(1)},{action:'transition',to:'refused',reason:'No'},{action:'courierWorkflow',operation:'confirm'},{action:'courierWorkflow',operation:'requestRepack',reason:'Change product'}])await act(doorId,'operator',body,400);
  await act(doorId,'logistic',{action:'courierWorkflow',operation:'recall',reason:'Recall'},400);
  await act(doorId,'courier',{action:'courierOutcome',to:'returned',reason:'No',confirmed:true},400);
  const waiting=(await call('operator')).data.reminders.find(r=>r.kind==='courier-door'&&r.orderId===doorId&&!r.resolved);
  await call('operator','/api/crm',{action:'readReminder',id:waiting.id});assert.ok(!(await call('operator')).data.reminders.find(r=>r.id===waiting.id).resolved);
  await act(doorId,'operator',{action:'courierWorkflow',operation:'claimDoor'});
  assert.equal((await call('courier')).data.orders.find(o=>o.id===doorId).courier.doorRefusal.claimedName,'Test operator');
  const oldVersion=order(doorId).version;
  await act(doorId,'head',{action:'courierWorkflow',operation:'claimDoor'});
  await call('operator','/api/crm',{action:'courierWorkflow',operation:'resolveDoor',id:doorId,version:oldVersion,result,confirmed:true},400);
  await act(doorId,'operator',{action:'courierWorkflow',operation:'resolveDoor',result,confirmed:true},400);
  const overdue=order(doorId);overdue.courier.doorRefusal.decisionDueAt=hours(-1);overdue.reworkDeadline=hours(-1);overdue.courier.operatorStartedAt=hours(-97);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(overdue),doorId);
  const late=(await call('head')).data;assert.equal(order(doorId).status,'rework');assert.equal(stock(),reserve);
  assert.ok(late.reminders.some(r=>r.kind==='courier-door'&&r.orderId===doorId&&!r.resolved&&r.title.includes('решение задерживается')));
  await act(doorId,'head',{action:'courierWorkflow',operation:'resolveDoor',result},400);
  await act(doorId,'head',{action:'courierWorkflow',operation:'resolveDoor',result,confirmed:true});
  assert.equal(order(doorId).courier.operatorBudgetMs,0);assert.equal(order(doorId).courier.doorRefusal.result,result);assert.equal(stock(),reserve);
  assert.ok(!(await call('courier')).data.reminders.some(r=>r.kind==='courier-door'&&r.orderId===doorId&&!r.resolved));
  await act(doorId,'head',{action:'courierWorkflow',operation:'resolveDoor',result,confirmed:true},400);
  if(result==='deliver'){
   assert.equal(order(doorId).status,'shipping');assert.equal(order(doorId).courier.phase,'resume');
   await act(doorId,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true},400);
   await act(doorId,'courier',{action:'courierWorkflow',operation:'resume'});
   await act(doorId,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});assert.equal(order(doorId).status,'redeemed');
  }else{
   assert.equal(order(doorId).status,'refused');assert.equal(order(doorId).warehouseReturnedAt,undefined);
   await act(doorId,'logistic',{action:'returnToWarehouse'});assert.equal(stock(),reserve+1);
   await act(doorId,'logistic',{action:'returnToWarehouse'},400);assert.equal(stock(),reserve+1);
  }
 }
 console.log('Door refusal: explicit presence, claim and takeover, department boundaries, two decisions, forbidden deferrals, overdue escalation without cancellation, custody and stock passed.');
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
 assert.ok(!noticeState.tasks.some(r=>r.id===moneyReceipt),'Unread receipt never counts as a task');
 await call('courier','/api/crm',{action:'readReminder',id:moneyReceipt});
 notices=courierNotices((await call('courier')).data);assert.ok(!notices.active.some(r=>r.id===moneyReceipt));assert.ok(notices.history.length<=20);
 console.log('Money, warehouse and repacking receipts: one notification, correct recipient, read/history and revoked order access passed.');
 console.log('All active courier tasks persist, viewed tasks stay actionable, missing tasks recover, completed history limited to 20.');
 console.log('Moscow API: real create/handoff/accept, operator-only returns, forbidden retired actions, operator calls, shared budget and legacy migration, money, expiry, physical return and stock passed.');
}finally{if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}db.close();rmSync(dir,{recursive:true,force:true});}

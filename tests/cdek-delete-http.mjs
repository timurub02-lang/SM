// Run after the Miran standalone build. No real CDEK requests or customer data.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {inventorySQL} from '../lib/inventory-sql.ts';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-cdek-delete-')),file=join(dir,'upstream.json'),db=new DatabaseSync(join(dir,'test.sqlite'));
const port=process.env.CDEK_TEST_PORT||'3096',base='http://127.0.0.1:'+port,origin='https://crm.test',password='synthetic-password-123';
const upstream=()=>JSON.parse(readFileSync(file,'utf8')),change=fn=>{const s=upstream();fn(s);writeFileSync(file,JSON.stringify(s));};
writeFileSync(file,JSON.stringify({mode:'pending',orders:{},calls:[]}));
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of [...authSchema,...inventorySQL])db.exec(sql);
 const hash=await hashPassword(password),cookies={};
 for(const role of ['admin','chief_logistic','logistic','operator','department_head']){
  const e={id:role,login:role,name:role,role,department:'1',salary:0,bonus:0,alias:'',skLogin:'',version:1};
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(role,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(role,hash);
 }
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:35}));
 db.prepare('INSERT INTO settings VALUES(?,?)').run('cdek-1',JSON.stringify({name:'Synthetic CDEK',clientId:'synthetic-client',clientSecret:'synthetic-secret'}));
 const client={id:'client',name:'Synthetic client',phone:'+79990000001',owner:'operator',sheet:'К',base:'M',createdAt:new Date().toISOString(),address:'Москва, ул. Тестовая, д. 1',city:'Москва',source:'Test',version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(client.id,client.phone,JSON.stringify(client));
 const product={id:'product',name:'Synthetic product',sku:'TEST',weight:100,cost:100,payment:100,version:1};db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run(product.id,product.name.toLowerCase(),JSON.stringify(product));
 db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('initial',product.id,100,'Test stock','admin',new Date().toISOString());
 server=spawn(process.execPath,['--import',resolve('tests/fixtures/cdek-fetch.mjs'),resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),CDEK_TEST_FIXTURE:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 async function call(path,role='admin',body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[role]?{cookie:cookies[role]}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,headers:r.headers};}
 for(const role of ['admin','chief_logistic','logistic','operator','department_head']){const r=await call('/api/auth/login',role,{login:role,password});assert.equal(r.status,200,r.text);cookies[role]=r.headers.get('set-cookie').split(';')[0];}
 async function worker(){
  const process=spawn(globalThis.process.execPath,['--experimental-strip-types','--import',resolve('tests/fixtures/cdek-fetch.mjs'),resolve('scripts/sync-cdek-deletions.mjs')],{env:{...globalThis.process.env,CRM_DATABASE_PATH:join(dir,'test.sqlite'),CDEK_TEST_FIXTURE:file},stdio:['ignore','pipe','pipe']});
  let output='',errors='';process.stdout.on('data',x=>output+=x);process.stderr.on('data',x=>errors+=x);const [code]=await once(process,'exit');
  assert.ok(output.trim(),errors);return {code,...JSON.parse(output.trim())};
 }
 const notices=id=>db.prepare("SELECT employee_id,data,read_at FROM reminders WHERE json_extract(data,'$.orderId')=? AND json_extract(data,'$.kind')='cdek-deletion' ORDER BY employee_id").all(id);
 const path='/api/cdek/shipment',readOrder=id=>{const r=db.prepare('SELECT data,version FROM orders WHERE id=?').get(id);return {...JSON.parse(r.data),version:r.version};};
 const shipment=id=>{const r=db.prepare('SELECT data FROM settings WHERE id=?').get('cdek-shipment-'+id);return r&&JSON.parse(r.data);};
 function fixture(id){
  const now=new Date().toISOString(),uuid=crypto.randomUUID();
  const order={id,clientId:'client',manager:'operator',logistic:'logistic',status:'shipping',delivery:'cdek_courier',items:[{name:product.name,quantity:1,price:100}],address:client.address,addressParts:{postalCode:'101000',region:'',city:'Москва',street:'Тестовая',house:'1',flat:''},comment:'',reason:'',contact:'none',due:'',extra:false,round:1,createdAt:now,updatedAt:now,shippedAt:now,cdekTransferredAt:now,cdekStatus:{code:'CREATED',at:now,revision:''},packingWaybillAt:now,cdekTariff:{code:139,slot:1,account:'Synthetic CDEK',name:'Test',amount:100,min:1,max:2,calculatedAt:now,params:{delivery:'cdek_courier',originPostalCode:'101000',originMode:'door',weight:1,length:10,width:10,height:10}},version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(id,'client',JSON.stringify(order));
  db.prepare('INSERT INTO settings VALUES(?,?)').run('cdek-shipment-'+id,JSON.stringify({attempt:crypto.randomUUID(),slot:1,account:'Synthetic CDEK',state:'ready',uuid,number:'OLD-'+id,createdAt:now,downloadedAt:now,printId:crypto.randomUUID(),form:{shipmentPoint:'',deliveryPoint:'',senderAddress:'Москва, ул. Складская, д. 1',payment:'cod',deliveryCost:0}}));
  change(s=>{s.orders[uuid]={number:id,cdek_number:'OLD-'+id,status:'CREATED'};s.mode='pending';});return {order,uuid};
 }
 const f=fixture('SM-DELETE');
 const remove=(id,role='admin',extra={})=>call(path,role,{action:'delete',orderId:id,version:readOrder(id).version,confirmed:true,reason:'Correct address',...extra});
 for(const role of ['operator','department_head','logistic'])assert.equal((await remove(f.order.id,role)).status,403,role);
 assert.equal((await remove(f.order.id,'admin',{confirmed:false})).status,400);
 assert.equal((await remove(f.order.id,'admin',{reason:''})).status,400);
 assert.equal((await remove(f.order.id,'admin',{version:99})).status,400);
 assert.equal(upstream().calls.length,0,'Rejected actions never contact CDEK');
 let r=await remove(f.order.id,'chief_logistic');assert.equal(r.status,200,r.text);assert.equal(r.data.shipment.state,'deleting');assert.equal(readOrder(f.order.id).status,'shipping');
 r=await call('/api/crm');const o=r.data.orders.find(o=>o.id===f.order.id);assert.equal(o.cdekExported,true);assert.equal(o.cdekDeleting,true);
 const held=db.prepare('SELECT * FROM order_stock WHERE order_id=?').all(f.order.id);
 assert.equal((await call(path,'admin',{action:'print',orderId:f.order.id})).status,400);
 assert.equal((await call('/api/crm','admin',{action:'comment',id:f.order.id,version:1,text:'Blocked'})).status,400);
 assert.equal((await call('/api/crm','admin',{action:'updateDelivery',id:f.order.id,version:1,delivery:'cdek_pickup'})).status,400);
 r=await call(path,'admin',{action:'create',orderId:f.order.id,version:1,form:shipment(f.order.id).form});assert.equal(r.data.shipment.state,'deleting');assert.equal(upstream().calls.filter(x=>x.path==='/v2/orders'&&x.method==='POST').length,0);
 r=await call(path,'logistic',{action:'refresh',orderId:f.order.id});assert.equal(r.data.shipment.state,'deleting','CREATE success must not count as DELETE success');
 const pendingCount=await worker();assert.equal(pendingCount.pending,1);assert.equal(notices(f.order.id).length,0,'No final notification for ACCEPTED');
 change(s=>s.orders[f.uuid].deletion='SUCCESSFUL');assert.equal((await worker()).completed,1);
 assert.deepEqual(notices(f.order.id).map(n=>n.employee_id),['admin','chief_logistic']);
 for(const role of ['admin','chief_logistic']){
  const bell=await call('/api/crm',role),notice=bell.data.reminders.find(n=>n.kind==='cdek-deletion'&&n.orderId===f.order.id);assert.ok(notice);assert.match(notice.title,/подтвердил/);assert.equal(notice.readAt,undefined);
 }
 assert.equal((await call('/api/crm','logistic')).data.reminders.some(n=>n.kind==='cdek-deletion'),false);
 const notification=JSON.parse(notices(f.order.id)[0].data);
 r=await call('/api/crm','admin',{action:'readReminder',id:notification.id});assert.equal(r.status,200,r.text);
 assert.ok(r.data.state.reminders.find(n=>n.id===notification.id).readAt);
 assert.equal((await worker()).checked,0,'Completed shipment removed from background queue');
 assert.equal(notices(f.order.id).length,2);assert.ok(notices(f.order.id)[0].read_at);
 assert.equal(notices(f.order.id)[1].read_at,null,'Read state is personal');
 const returned=readOrder(f.order.id);assert.equal(returned.status,'packing');assert.ok(returned.cdekReturnedAt);assert.equal(returned.cdekStatus,undefined);assert.equal(returned.shippedAt,undefined);assert.ok(returned.packingWaybillAt);assert.equal(returned.clientId,'client');assert.equal(shipment(f.order.id),undefined);
 assert.deepEqual(db.prepare('SELECT * FROM order_stock WHERE order_id=?').all(f.order.id),held,'Returning the shipment must not free stock');
 const archived=db.prepare("SELECT data FROM settings WHERE id LIKE 'cdek-archive-%'").all();assert.equal(archived.length,1);assert.equal(JSON.parse(archived[0].data).uuid,f.uuid);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE id LIKE 'cdek-shipment-%'").get().n,0,'Archived shipment no longer consumes routing quota');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM events WHERE order_id=?').get(f.order.id).n,1);
 assert.equal((await call(path,'admin',{action:'refresh',orderId:f.order.id})).status,400,'Old shipment is no longer active');
 // Admin edits the returned basket; logistics retains its established no-basket-edit permission.
 r=await call('/api/crm','chief_logistic',{action:'updateOrder',id:f.order.id,version:returned.version,items:[{name:product.name,quantity:2,price:100}],addressConfirmed:true});assert.equal(r.status,400);
 r=await call('/api/crm','admin',{action:'updateOrder',id:f.order.id,version:returned.version,items:returned.items,address:client.address,comment:'Corrected',addressConfirmed:true});assert.equal(r.status,200,r.text);
 const corrected=readOrder(f.order.id);r=await call(path,'admin',{action:'create',orderId:f.order.id,version:corrected.version,form:JSON.parse(archived[0].data).form});assert.equal(r.status,200,r.text);assert.equal(r.data.shipment.state,'ready');assert.notEqual(r.data.shipment.uuid,f.uuid);assert.equal(r.data.shipment.printId,undefined);assert.equal(r.data.shipment.downloadedAt,undefined);
 const created=upstream().calls.find(x=>x.path==='/v2/orders'&&x.method==='POST');assert.equal(created.body.number,f.order.id,'Reuse CRM number after confirmed deletion');
 // CDEK refusal leaves the order, invoice and stock unchanged.
 const reject=fixture('SM-REJECT');change(s=>s.mode='reject');r=await remove(reject.order.id);assert.equal(r.data.shipment.state,'ready');assert.match(r.data.shipment.error,/Warehouse/);assert.equal(readOrder(reject.order.id).status,'shipping');assert.equal(readOrder(reject.order.id).cdekReturnedAt,undefined);assert.equal(notices(reject.order.id).length,2);assert.match(JSON.parse(notices(reject.order.id)[0].data).text,/Warehouse/);
 const moved=fixture('SM-MOVED');change(s=>s.orders[moved.uuid].status='RECEIVED_AT_SHIPMENT_WAREHOUSE');const callsBefore=upstream().calls.filter(x=>x.method==='DELETE').length;r=await remove(moved.order.id);assert.equal(r.status,400);assert.equal(upstream().calls.filter(x=>x.method==='DELETE').length,callsBefore);
 // Unknown response remains blocked until GET explicitly confirms the deletion.
 const timeout=fixture('SM-TIMEOUT');change(s=>s.mode='timeout');r=await remove(timeout.order.id);assert.equal(r.data.shipment.state,'deleting');change(s=>s.orders[timeout.uuid].deletion='SUCCESSFUL');r=await call(path,'admin',{action:'refresh',orderId:timeout.order.id});assert.equal(r.data.changed,true);
 const immediate=fixture('SM-IMMEDIATE');change(s=>s.mode='immediate');r=await remove(immediate.order.id);assert.equal(r.data.changed,true);assert.equal(readOrder(immediate.order.id).status,'packing');assert.equal(notices(immediate.order.id).length,2,'Immediate DELETE responses also notify');
 // A refresh already on the wire cannot resurrect an old shipment after rollback.
 const race=fixture('SM-RACE');change(s=>{s.mode='immediate';s.delayNextGet=true;});const before=upstream().calls.length;
 const stale=call(path,'admin',{action:'refresh',orderId:race.order.id});while(upstream().calls.length<before+2)await new Promise(r=>setTimeout(r,10));
 r=await remove(race.order.id);assert.equal(r.data.changed,true,r.text);assert.equal((await stale).status,400);assert.equal(shipment(race.order.id),undefined);assert.equal(readOrder(race.order.id).status,'packing');
 // Retry a failed deletion: a new result gets its own notification, older read flags remain.
 change(s=>{s.mode='pending';s.orders[reject.uuid].deletion=undefined;});
 r=await remove(reject.order.id);assert.equal(r.data.shipment.state,'deleting');
 change(s=>s.orders[reject.uuid].deletion='INVALID');assert.equal((await worker()).completed,1);
 assert.equal(notices(reject.order.id).length,4,'Each deletion attempt is distinct');
 assert.match(JSON.parse(notices(reject.order.id)[3].data).text,/Warehouse/);
 // Production CDEK no longer returns deleted entities; never accept unrelated or unacknowledged missing responses.
 const gone=fixture('SM-GONE');r=await remove(gone.order.id);assert.ok(r.data.shipment.deletion.requestId);
 change(s=>{s.orders[gone.uuid].gone=true;s.orders[gone.uuid].goneCode='v2_entity_forbidden';});
 assert.equal((await worker()).failed,1);assert.equal(notices(gone.order.id).length,0);
 change(s=>{delete s.orders[gone.uuid].goneCode;s.orders[gone.uuid].goneUuid=crypto.randomUUID();});
 assert.equal((await worker()).failed,1);assert.equal(shipment(gone.order.id).state,'deleting');
 change(s=>delete s.orders[gone.uuid].goneUuid);
 assert.equal((await worker()).completed,1);assert.equal(readOrder(gone.order.id).status,'packing');assert.equal(notices(gone.order.id).length,2);
 const goneRefresh=fixture('SM-GONE-REFRESH');await remove(goneRefresh.order.id);change(s=>s.orders[goneRefresh.uuid].gone=true);
 r=await call(path,'admin',{action:'refresh',orderId:goneRefresh.order.id});assert.equal(r.data.changed,true,r.text);assert.equal(notices(goneRefresh.order.id).length,2);
 const unknownGone=fixture('SM-UNKNOWN-GONE');change(s=>s.mode='timeout');await remove(unknownGone.order.id);change(s=>s.orders[unknownGone.uuid].gone=true);
 assert.equal((await worker()).failed,1);assert.equal(notices(unknownGone.order.id).length,0);
 change(s=>{delete s.orders[unknownGone.uuid].gone;s.orders[unknownGone.uuid].deletion='SUCCESSFUL';});
 assert.equal((await worker()).completed,1);
 console.log('Deleted-entity responses passed: acknowledged exact UUID only, API refresh and worker; forbidden, wrong UUID and unacknowledged deletion stay blocked.');
 // A network outage must not create a rejection; the next worker resumes after the web app stops.
 const background=fixture('SM-BACKGROUND');r=await remove(background.order.id);assert.equal(r.data.shipment.state,'deleting');
 change(s=>s.getFailureUuid=background.uuid);assert.equal((await worker()).failed,1);assert.equal(notices(background.order.id).length,0);assert.equal(readOrder(background.order.id).status,'shipping');
 change(s=>{delete s.getFailureUuid;s.orders[background.uuid].deletion='SUCCESSFUL';});
 server.kill('SIGTERM');await once(server,'exit');server=undefined;
 assert.equal((await worker()).completed,1);assert.equal(readOrder(background.order.id).status,'packing');assert.equal(notices(background.order.id).length,2);
 assert.equal((await worker()).checked,0);assert.equal(notices(background.order.id).length,2);
 console.log('Background and bell checks passed: no browser/server, pending, recovery, success/refusal, exact recipients, distinct retries, personal read history and no duplicates.');
 console.log('CDEK deletion HTTP passed: roles, async confirmation, rollback, stock, archive, quota, edits, same-number re-export, refusals, timeout and stale refresh.');
}catch(e){console.error(logs.slice(-6000));throw e;}finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();if(process.env.CDEK_TEST_KEEP)console.log("Preview fixture: "+dir);else rmSync(dir,{recursive:true,force:true});}

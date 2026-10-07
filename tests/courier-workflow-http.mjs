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
 await act(id,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true},400);
 await act(id,'logistic',{action:'contact',contact:'missed',reason:'Test'},400);
 await act(id,'courier',{action:'contact',contact:'callback',reason:'Later',due:hours(49)},400);
 await act(id,'courier',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
 await act(id,'courier',{action:'courierWorkflow',operation:'toLogistic',reason:'No answer'});assert.equal(order(id).courier.phase,'logistic');assert.equal(stock(),before);
 await act(id,'logistic',{action:'contact',contact:'callback',reason:'Later',due:hours(1)});
 for(const employee of ['logistic','second','chief']){const s=(await call(employee)).data;assert.ok(s.reminders.some(r=>r.kind==='call'&&r.orderId===id&&r.text.includes('Test logistic')));}
 // Existing simultaneous-edit protection also covers the new logistic actions.
 const token=crypto.randomUUID();await call('logistic','/api/order-access',{action:'acquire',orderId:id,token});
 await act(id,'second',{action:'courierWorkflow',operation:'confirm'},409);
 await call('logistic','/api/order-access',{action:'release',orderId:id,token});
 await act(id,'logistic',{action:'courierWorkflow',operation:'confirm'});assert.equal(order(id).courier.phase,'resume');
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
 await act(id,'courier',{action:'courierWorkflow',operation:'requestPostpone',reason:'Client away',at:hours(200)});
 await act(id,'courier',{action:'courierWorkflow',operation:'approvePostpone'},400);
 await act(id,'chief',{action:'courierWorkflow',operation:'approvePostpone'});assert.equal(order(id).courier.postponement.state,'approved');assert.equal(order(id).courier.workStartedAt,undefined);
 await act(id,'courier',{action:'courierOutcome',to:'redeemed',confirmed:true});assert.equal(stock(),before);
 await act(id,'logistic',{action:'receivePayment'});await act(id,'logistic',{action:'receivePayment'},400);
 assert.equal(db.prepare('SELECT amount FROM cash_operations WHERE order_id=?').get(id).amount,1000000);
 // Expired confirmation returns work, expired shared budget cancels sale but keeps the parcel reserved.
 const returnedId=await create();await assembled(returnedId);await act(returnedId,'courier',{action:'courierAccept',confirmed:true});
 const accepted=order(returnedId);accepted.courier.workStartedAt=hours(-49);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(accepted),returnedId);await call('operator');assert.equal(order(returnedId).status,'rework');
 const reserved=stock(),rework=order(returnedId);rework.reworkDeadline=hours(-1);rework.courier.operatorStartedAt=hours(-97);db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(rework),returnedId);await call('courier');assert.equal(order(returnedId).status,'refused');assert.equal(stock(),reserved);
 await act(returnedId,'courier',{action:'returnToWarehouse'},403);await act(returnedId,'logistic',{action:'returnToWarehouse'});assert.equal(stock(),reserved+1);await act(returnedId,'logistic',{action:'returnToWarehouse'},400);
 console.log('Moscow API: real create/handoff/accept, ownership and locks, calls to all logistics, repeated operator budget, approved postponement, money, expiry, physical return and stock passed.');
}finally{if(server&&server.exitCode===null){const exited=once(server,'exit');server.kill('SIGTERM');await exited;}db.close();rmSync(dir,{recursive:true,force:true});}

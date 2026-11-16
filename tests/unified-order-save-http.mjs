import {pathToFileURL} from 'node:url';
// Isolated application/API test: no real customer, payment or carrier access.
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
const dir=mkdtempSync(join(tmpdir(),'crm-pickup-point-')),db=new DatabaseSync(join(dir,'test.sqlite')),origin='https://crm.test',port='3121',base='http://127.0.0.1:'+port,password='synthetic-test-password';
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of [...authSchema,...inventorySQL])db.exec(sql);
 db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').run('p','product',JSON.stringify({id:'p',name:'Product'}));db.prepare("INSERT INTO stock_movements VALUES('initial','p',100,'test','admin',?)").run(new Date().toISOString());
 const upstreamFile=join(dir,'upstream.json');writeFileSync(upstreamFile,JSON.stringify({calls:[],orders:{},points:[{code:'MSK1',status:'ACTIVE',is_handout:true,location:{address_full:'Москва, Тестовая, 1',postal_code:'101000'},work_time:'09–20'},{code:'CLOSED',status:'CLOSED',is_handout:true,location:{address_full:'Закрытый'}}]}));
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('cdek-1',JSON.stringify({name:'Test account',clientId:'synthetic',clientSecret:'synthetic'}));
 const hash=await hashPassword(password),cookies={};
 for(const [id,role,department] of [['admin','admin',''],['op','operator','1'],['foreign','operator','2'],['head','department_head','1'],['other-head','department_head','2'],['log','logistic',''],['second','chief_logistic','']]){
 const e={id,login:id,name:id,alias:'',role,department,salary:0,bonus:0,version:1};db.prepare('INSERT INTO employees VALUES(?,?,1)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 const now=new Date().toISOString(),client={id:'c',name:'Тестов Иван Иванович',phone:'+79990000001',owner:'op',source:'test',city:'Москва',address:'101000, Москва, Тестовая, д1',baseType:'M',sheet:'К',createdAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:now};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c',client.phone,JSON.stringify(client));
 const initial={id:'post',clientId:'c',manager:'op',logistic:'log',status:'draft',draftHours:null,delivery:'cdek_pickup',address:'101000, Москва, Тестовая, д1',addressParts:{postalCode:'101000',region:'',city:'Москва',street:'Тестовая',house:'1',flat:''},items:[{name:'Product',quantity:1,price:10000}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,shippedAt:''};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run('post','c',JSON.stringify(initial));
 server=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/fixtures/cdek-fetch.mjs')).href,resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),CDEK_TEST_FIXTURE:upstreamFile,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(actor,path,body,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[actor]?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return {data,headers:r.headers};}
 for(const actor of ['admin','op','foreign','head','other-head','log','second']){const r=await call(actor,'/api/auth/login',{login:actor,password});cookies[actor]=r.headers.get('set-cookie').split(';')[0];}
 const order=()=>{const row=db.prepare("SELECT data,version FROM orders WHERE id='post'").get();return {...JSON.parse(row.data),version:row.version};};
 const act=(actor,action,extra={},expected=200)=>call(actor,'/api/crm',{action,id:'post',version:order().version,responseMode:'entity-patch',...extra},expected);
 const loaded=(await call('op','/api/cdek/pickup-points?orderId=post')).data;
 const data={action:'updateOrder',delivery:initial.delivery,address:initial.address,addressParts:initial.addressParts,items:initial.items};
 const pickup={action:'selectOrderPickupPoint',code:'MSK1',selectionId:loaded.selectionId};
 const save=(actor,changes,extra={},expected=200)=>act(actor,'saveOrder',{changes,...extra},expected);
 const clientRow=()=>{const r=db.prepare("SELECT data,version FROM clients WHERE id='c'").get();return {...JSON.parse(r.data),version:r.version};};
 const eventCount=()=>db.prepare("SELECT count(*) n FROM events WHERE order_id='post'").get().n;
 let before=order(),count=eventCount();
 await save('op',[{...data,newOrderComment:'Operator comment'},pickup,{action:'comment',text:'One combined save'}]);
 assert.equal(order().version,before.version+1);assert.equal(eventCount(),count+1);assert.equal(order().cdekPickupPoint.code,'MSK1');assert.match(JSON.stringify(order()),/Operator comment/);
 assert.match(db.prepare("SELECT data FROM events WHERE order_id='post' ORDER BY rowid DESC LIMIT 1").get().data,/One combined save/);
 before=order();count=eventCount();
 await save('op',[{...data,newOrderComment:'Must not save'}, {...pickup,code:'FORGED'}],{},400);assert.deepEqual(order(),before);assert.equal(eventCount(),count);
 await save('op',[{action:'comment',text:'Forbidden combined save'},{action:'updateLogisticComment',text:'No operator access'}],{},400);assert.deepEqual(order(),before);assert.equal(eventCount(),count);
 await save('foreign',[{action:'comment',text:'Foreign'}],{},403);
 await save('op',[{action:'comment',text:'Old revision'}],{version:before.version-1},400);assert.deepEqual(order(),before);
 await save('admin',[{action:'updateRecipientName',name:'Новое ФИО',clientVersion:clientRow().version},{action:'updateLogisticComment',text:'Logistic comment'},{action:'comment',text:'Name and comment'}]);
 assert.equal(clientRow().name,'Новое ФИО');assert.equal(order().logisticComment,'Logistic comment');assert.equal(order().version,before.version+1);assert.equal(eventCount(),count+1);
 before=order();count=eventCount();let clientBefore=clientRow();
 await save('admin',[{...data,newOrderComment:'Atomic address/name'}, {action:'updateRecipientName',name:'Другое ФИО',clientVersion:clientBefore.version-1},{action:'updateLogisticComment',text:'Must not save'}],{},400);
 assert.deepEqual(order(),before);assert.deepEqual(clientRow(),clientBefore);assert.equal(eventCount(),count);
 await save('admin',[{...data,address:'101000, Москва, Тестовая, д2',addressParts:{...initial.addressParts,house:'2'}},{action:'updateRecipientName',name:'Другое ФИО',clientVersion:clientRow().version},{action:'updateLogisticComment',text:'Combined data and name'}]);
 assert.equal(order().addressParts.house,'2');assert.equal(clientRow().addressParts.house,'2');assert.equal(clientRow().name,'Другое ФИО');assert.equal(order().version,before.version+1);assert.equal(clientRow().version,clientBefore.version+1);assert.equal(order().logisticComment,'Combined data and name');
 before=order();db.prepare("UPDATE orders SET data=? WHERE id='post'").run(JSON.stringify({...before,delivery:'russian_post',status:'packing'}));
 const postData={...data,delivery:'russian_post',address:'101000, Москва, Тестовая, д3',addressParts:{...initial.addressParts,house:'3'}};
 await save('log',[postData,{action:'saveManualDeliveryCost',amount:350},{action:'savePostalTracking',trackingNumber:' ra 123 456 '},{action:'updateLogisticComment',text:'Postal combined'}]);
 assert.equal(order().manualDeliveryCost,350);assert.equal(order().postalTrackingNumber,'RA123456');assert.equal(order().logisticComment,'Postal combined');assert.equal(order().addressParts.house,'3');
 before=order();count=eventCount();
 await save('log',[{action:'updateLogisticComment',text:'Must not save'}, {action:'savePostalTracking',trackingNumber:'INVALID!'}],{},400);assert.deepEqual(order(),before);assert.equal(eventCount(),count);
 await save('log',[{action:'updateLogisticComment',text:'Must not save'}, {action:'saveManualDeliveryCost',amount:-1}],{},400);assert.deepEqual(order(),before);
 db.prepare("UPDATE orders SET data=? WHERE id='post'").run(JSON.stringify({...before,delivery:'moscow_courier',status:'shipping',courier:{id:'courier',name:'courier',amount:10000}}));
 await save('log',[{action:'updateMoscowDetails',name:'Получатель Москва',clientVersion:clientRow().version,address:'101000, Москва, Тестовая, д4',addressParts:{...initial.addressParts,house:'4'},logisticComment:'Moscow combined'}]);
 assert.equal(clientRow().name,'Получатель Москва');assert.equal(order().addressParts.house,'4');assert.equal(order().logisticComment,'Moscow combined');
 before=order();await save('log',[{action:'updateLogisticComment',text:'Must not save'},{action:'saveManualDeliveryCost',amount:999}],{},400);assert.deepEqual(order(),before);
 // Sent orders keep a single save for comments, but still reject recipient/data changes.
 db.prepare("UPDATE orders SET data=? WHERE id='post'").run(JSON.stringify({...before,delivery:'cdek_pickup',cdekExported:true,shippedAt:now}));
 await save('log',[{action:'updateLogisticComment',text:'Sent comment'}]);assert.equal(order().logisticComment,'Sent comment');before=order();
 await save('log',[{action:'updateLogisticComment',text:'Must not save'},{action:'updateRecipientName',name:'Forbidden',clientVersion:clientRow().version}],{},400);assert.deepEqual(order(),before);
 await save('admin',[{action:'deleteEmployee',id:'op'}],{},400);
 console.log('Unified order save HTTP: operator PVZ/data/note, admin name and client version, logistic post/cost/tracking and Moscow fields, shipped comments, atomic failure and permission guards passed');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}db.close();rmSync(dir,{recursive:true,force:true});}

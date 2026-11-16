import {pathToFileURL} from 'node:url';
// Isolated application/API test: no real customer, payment or carrier access.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-pickup-point-')),db=new DatabaseSync(join(dir,'test.sqlite')),origin='https://crm.test',port='3118',base='http://127.0.0.1:'+port,password='synthetic-test-password';
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)db.exec(sql);
 const upstreamFile=join(dir,'upstream.json');writeFileSync(upstreamFile,JSON.stringify({calls:[],orders:{},points:[{code:'MSK1',status:'ACTIVE',is_handout:true,location:{address_full:'Москва, Тестовая, 1',postal_code:'101000'},work_time:'09–20'},{code:'CLOSED',status:'CLOSED',is_handout:true,location:{address_full:'Закрытый'}}]}));
 db.prepare('INSERT INTO settings(id,data) VALUES(?,?)').run('cdek-1',JSON.stringify({name:'Test account',clientId:'synthetic',clientSecret:'synthetic'}));
 const hash=await hashPassword(password),cookies={};
 for(const [id,role,department] of [['op','operator','1'],['foreign','operator','2'],['head','department_head','1'],['other-head','department_head','2'],['log','logistic',''],['second','chief_logistic','']]){
 const e={id,login:id,name:id,alias:'',role,department,salary:0,bonus:0,version:1};db.prepare('INSERT INTO employees VALUES(?,?,1)').run(id,JSON.stringify(e));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 const now=new Date().toISOString(),client={id:'c',name:'Тестов Иван Иванович',phone:'+79990000001',owner:'op',source:'test',city:'Москва',address:'101000, Москва, Тестовая, д1',baseType:'M',sheet:'К',createdAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:now};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('c',client.phone,JSON.stringify(client));
 const initial={id:'post',clientId:'c',manager:'op',logistic:'log',status:'draft',draftHours:null,delivery:'cdek_pickup',address:'101000, Москва, Тестовая, д1',addressParts:{postalCode:'101000',region:'',city:'Москва',street:'Тестовая',house:'1',flat:''},items:[{name:'Product',quantity:1,price:10000}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,shippedAt:now};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run('post','c',JSON.stringify(initial));
 server=spawn(process.execPath,['--import',pathToFileURL(resolve('tests/fixtures/cdek-fetch.mjs')).href,resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),CDEK_TEST_FIXTURE:upstreamFile,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function call(actor,path,body,expected=200){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookies[actor]?{cookie:cookies[actor]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return {data,headers:r.headers};}
 for(const actor of ['op','foreign','head','other-head','log','second']){const r=await call(actor,'/api/auth/login',{login:actor,password});cookies[actor]=r.headers.get('set-cookie').split(';')[0];}
 const order=()=>{const row=db.prepare("SELECT data,version FROM orders WHERE id='post'").get();return {...JSON.parse(row.data),version:row.version};};
 const act=(actor,action,extra={},expected=200)=>call(actor,'/api/crm',{action,id:'post',version:order().version,responseMode:'entity-patch',...extra},expected);
 await act('op','transition',{to:'confirm'},400);assert.equal(order().status,'draft');
 await call('foreign','/api/cdek/pickup-points?orderId=post',undefined,403);await call('other-head','/api/cdek/pickup-points?orderId=post',undefined,403);
 const loaded=(await call('op','/api/cdek/pickup-points?orderId=post')).data;assert.deepEqual(loaded.points.map(p=>p.code),['MSK1']);assert.ok(loaded.selectionId);assert.equal(JSON.stringify(loaded).includes('clientSecret'),false);
 await act('op','selectOrderPickupPoint',{code:'FORGED',selectionId:loaded.selectionId},400);
 const saveData={delivery:initial.delivery,address:initial.address,addressParts:initial.addressParts,items:initial.items};
 const unsaved=order();assert.equal(unsaved.cdekPickupPoint,undefined);
 await act('op','updateOrder',{...saveData,newOrderComment:'Must not persist',pickupPoint:{code:'FORGED',selectionId:loaded.selectionId}},400);
 assert.deepEqual(order(),unsaved,'invalid PVZ must not partially save order/comment/version');
 await act('foreign','updateOrder',{...saveData,pickupPoint:{code:'MSK1',selectionId:loaded.selectionId}},403);
 await act('op','updateOrder',{...saveData,address:initial.address+' changed',pickupPoint:{code:'MSK1',selectionId:loaded.selectionId}},400);
 assert.deepEqual(order(),unsaved,'stale context must not partially save the changed address');
 await act('op','updateOrder',{...saveData,pickupPoint:{code:'MSK1',selectionId:loaded.selectionId}});
 assert.equal(order().cdekPickupPoint.code,'MSK1');assert.equal(order().version,unsaved.version+1,'order and PVZ saved together once');
 const saved=order();await act('op','updateOrder',{...saveData,version:unsaved.version,pickupPoint:{code:'MSK1',selectionId:loaded.selectionId}},400);assert.deepEqual(order(),saved,'stale version cannot overwrite saved order/PVZ');
 await act('head','selectOrderPickupPoint',{code:'MSK1',selectionId:loaded.selectionId});assert.equal(order().cdekPickupPoint.code,'MSK1');
 const before=order();db.prepare("UPDATE orders SET data=? WHERE id='post'").run(JSON.stringify({...before,address:'101000, Москва, Другой дом'}));
 await act('op','transition',{to:'confirm'},400);await act('op','selectOrderPickupPoint',{code:'MSK1',selectionId:loaded.selectionId},400);
 db.prepare("UPDATE orders SET data=? WHERE id='post'").run(JSON.stringify(before));
 await act('op','transition',{to:'confirm'});assert.equal(order().status,'confirm');assert.equal(order().cdekPickupPoint.code,'MSK1');
 const logistic=(await call('log','/api/crm')).data.orders.find(o=>o.id==='post');assert.equal(logistic.cdekPickupPoint.address,'Москва, Тестовая, 1');
 await call('op','/api/cdek/pickup-points?orderId=post',undefined,403);
 const requests=JSON.parse(readFileSync(upstreamFile,'utf8')).calls;assert.equal(requests.some(c=>c.path==='/v2/orders'),false);
 console.log('Pickup handoff HTTP: missing/forged/stale denied, own operator/head lookup and save, foreign denied, closed PVZ excluded, retained at logistics, no shipment created');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){const exit=once(server,'exit');server.kill('SIGTERM');await exit;}db.close();rmSync(dir,{recursive:true,force:true});}

// Run after a Miran standalone build. Only synthetic data in a temporary database.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-postal-')),db=new DatabaseSync(join(dir,'test.sqlite'));
const origin='https://crm.test',port=process.env.POSTAL_TEST_PORT||'3116',base=`http://127.0.0.1:${port}`;
let server,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const password='test-postal-only-123',hash=await hashPassword(password);
 const roles=['admin','logistic','chief_logistic','operator','department_head','courier'];
 for(const role of roles){
  const e={id:role,login:role,name:'Test '+role,role,department:'1',salary:0,bonus:0,version:1};
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(role,JSON.stringify(e));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(role,hash);
 }
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:35}));
 const now=new Date().toISOString();
 const client={id:'client',name:'Тестовый Получатель',phone:'+79990000001',address:'Старый адрес',source:'Synthetic',base:'M',sheet:'К',city:'Москва',owner:'operator',createdAt:now,version:1};
 const order={id:'order',clientId:client.id,manager:'operator',logistic:'logistic',delivery:'russian_post',status:'packing',address:'101000, г. Москва, ул. Тестовая, дом 1',addressParts:{postalCode:'101000'},items:[{name:'ИТОГО',quantity:1,price:8900},{name:'Товар',quantity:2,price:0}],comment:'',reason:'',contact:'none',due:'',round:1,extra:false,createdAt:now,updatedAt:now,version:1};
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(client.id,client.phone,JSON.stringify(client));
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(order.id,client.id,JSON.stringify(order));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<100;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,'Server failed to start');
 const cookies={};
 async function call(path,role,body,extraHeaders={}){
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(role?{cookie:cookies[role]}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{}),...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),headers:r.headers};
 }
 for(const role of roles){const r=await call('/api/auth/login',undefined,{login:role,password});assert.equal(r.status,200);cookies[role]=r.headers.get('set-cookie').split(';')[0];}
 assert.equal((await call('/api/postal-form')).status,401);
 for(const role of ['operator','department_head','courier'])assert.equal((await call('/api/postal-form',role)).status,403);
 assert.equal((await call('/api/postal-form','logistic')).data.sender.name,'');
 assert.equal((await call('/api/postal-form?orderId=order&version=1','logistic')).status,400);
 const sender={name:'Тестовый отправитель',address:'г. Москва, улица Тестовая, дом 2',postalCode:'101000',phone:'+79990000002'};
 for(const role of roles.filter(x=>x!=='admin'))assert.equal((await call('/api/postal-form',role,{sender,revision:''})).status,403);
 assert.equal((await call('/api/postal-form','admin',{sender,revision:''},{Origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/postal-form','admin',{sender:{...sender,postalCode:'12'},revision:''})).status,400);
 const saved=await call('/api/postal-form','admin',{sender,revision:''});assert.equal(saved.status,200);
 assert.equal((await call('/api/postal-form','admin',{sender,revision:''})).status,409);
 const original=db.prepare('SELECT data FROM orders WHERE id=?').get(order.id).data;
 for(const role of ['admin','logistic','chief_logistic']){
  const r=await call('/api/postal-form?orderId=order&version=1',role);assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.amount,8900);assert.deepEqual(r.data.sender,sender);assert.equal(r.data.recipient.postalCode,'101000');assert(!r.data.recipient.address.includes('Старый'));
 }
 assert.equal((await call('/api/postal-form?actorId=admin&orderId=order&version=1','logistic')).status,403);
 assert.equal((await call('/api/postal-form?orderId=order&version=2','logistic')).status,409);
 assert.equal(db.prepare('SELECT data FROM orders WHERE id=?').get(order.id).data,original);
 await call('/api/crm','admin');
 const clientBeforeTracking=db.prepare('SELECT data FROM clients WHERE id=?').get(client.id).data;
 const currentOrder=()=>{const r=db.prepare('SELECT data,version FROM orders WHERE id=?').get(order.id);return {...JSON.parse(r.data),version:r.version};};
 async function saveTrack(role,trackingNumber,version=currentOrder().version){return call('/api/crm',role,{action:'savePostalTracking',id:order.id,version,trackingNumber});}
 for(const role of ['operator','department_head','courier']){const denied=await saveTrack(role,'12345678901234');assert([400,403].includes(denied.status));assert.match(denied.data.error,/прав|доступ/);}
 for(const value of ['<script>','трек','A'.repeat(41)])assert.equal((await saveTrack('logistic',value)).status,400);
 const trackingSaved=await saveTrack('logistic',' 1234 5678 9012 34 ');
 assert.equal(trackingSaved.status,200,JSON.stringify(trackingSaved.data));
 assert.equal(currentOrder().postalTrackingNumber,'12345678901234');
 const withTrack=await call('/api/postal-form?orderId=order&version='+currentOrder().version,'logistic');
 assert.equal(withTrack.data.trackingNumber,'12345678901234');assert.deepEqual(withTrack.data.sender,sender);
 assert.equal((await saveTrack('logistic','99999999999999',1)).status,400,'Stale edits must fail');
 assert.equal(currentOrder().postalTrackingNumber,'12345678901234');
 assert.equal((await saveTrack('chief_logistic','ra123456789ru')).status,200);
 assert.equal(currentOrder().postalTrackingNumber,'RA123456789RU');
 assert.equal((await saveTrack('admin','')).status,200);
 assert.equal(currentOrder().postalTrackingNumber,'');
 const afterTracking=currentOrder();assert.equal(afterTracking.status,order.status);assert.deepEqual(afterTracking.items,order.items);
 assert.equal(db.prepare('SELECT data FROM clients WHERE id=?').get(client.id).data,clientBeforeTracking);
 const trackingEvents=db.prepare("SELECT data FROM events WHERE order_id=?").all(order.id).map(r=>JSON.parse(r.data));
 assert(trackingEvents.some(e=>e.text.includes('12345678901234')));
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...afterTracking,delivery:'moscow_courier'}),order.id);
 assert.equal((await saveTrack('admin','12345678901234')).status,400,'Only postal orders accept postal tracking');

 assert.equal((await call('/api/postal-form?orderId=order&version='+currentOrder().version,'logistic')).status,400);
 console.log('Postal HTTP: auth/roles, sender validation, revision conflicts, saved order data, no status or financial writes passed');
}catch(error){console.error(logs);throw error;}
finally{if(server){server.kill('SIGTERM');await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'stats-access-')),file=join(dir,'test.sqlite'),base='http://127.0.0.1:3398',origin='https://crm.test';
const db=new DatabaseSync(file);let server,logs='';
async function call(path,cookie,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,text:await r.text()};}
try{
 db.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword('synthetic-statistics-2026');
 for(const [id,role,department] of [['admin','admin','1'],['head','department_head','1'],['operator','operator','1'],['other','operator','2']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role,department}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('private-client','+79990000001',JSON.stringify({id:'private-client',phone:'+79990000001',name:'PRIVATE CLIENT',owner:'other'}));
 const order={id:'PRIVATE-ORDER',clientId:'private-client',manager:'other',createdAt:'2026-11-11T10:00:00Z',status:'confirm',items:[{name:'PRIVATE ITEM',price:12345,quantity:1}]};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(order.id,order.clientId,JSON.stringify(order));
 const paid={...order,id:'PRIVATE-PAID',legacyLv:{orderId:'old'},status:'redeemed',delivery:'cdek_pickup',redeemedAt:'2026-11-11T10:00:00Z'};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(paid.id,paid.clientId,JSON.stringify(paid));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3398'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const cookies={};for(const id of ['admin','head','operator']){const r=await call('/api/auth/login',null,{login:id,password:'synthetic-statistics-2026'});assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 const path='/api/operator-statistics?from=2026-11-11&to=2026-11-11';
 assert.equal((await call(path)).status,401);
 assert.equal((await call(path,cookies.operator)).status,403);
 for(const id of ['admin','head']){
  const response=await call(path,cookies[id]);assert.equal(response.status,200,response.text);
  const row=JSON.parse(response.text).rows.find(r=>r.id==='other');assert.equal(row.created,1);assert.equal(row.inWork,1);assert.equal(row.awaitingShipment,0);assert.equal(row.amount,12345);assert.equal(row.department,'2');
  assert.deepEqual(Object.keys(row).sort(),['id','login','department','inWork','created','amount','average','cancelled','confirmed','awaitingShipment','sent','buyoutCount','buyoutAmount','buyoutCdek','buyoutPost','buyoutMoscow'].sort());
  assert.equal(row.buyoutCdek,1);assert.equal(row.buyoutPost,0);assert.equal(row.buyoutMoscow,0);
  for(const privateValue of ['PRIVATE-PAID','PRIVATE-ORDER','private-client','PRIVATE CLIENT','PRIVATE ITEM','79990000001'])assert.ok(!response.text.includes(privateValue));
 }
 assert.equal((await call(path+'&actorId=admin',cookies.head)).status,403);
 assert.equal((await call('/api/operator-statistics?from=bad',cookies.head)).status,400);
 const empty=await call('/api/operator-statistics?from=2026-11-12&to=2026-11-12',cookies.head);assert.ok(JSON.parse(empty.text).rows.every(r=>r.created===0));
 // Existing object-level access remains closed for another department's orders.
 assert.equal((await call('/api/order-access',cookies.head,{orderId:order.id})).status,403);
 console.log('Statistics HTTP: head aggregates only, dates, role and identity checks, private orders inaccessible');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

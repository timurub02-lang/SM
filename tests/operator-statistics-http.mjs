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
 for(const [id,role,department] of [['admin','admin','1'],['head','department_head','1'],['operator','operator','1'],['other','operator','2'],['buyer','redemption','']]){
  db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role,department}));
  db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run('private-client','+79990000001',JSON.stringify({id:'private-client',phone:'+79990000001',name:'PRIVATE CLIENT',owner:'other'}));
 const order={id:'PRIVATE-ORDER',clientId:'private-client',manager:'other',createdAt:'2026-11-11T10:00:00Z',status:'confirm',items:[{name:'PRIVATE ITEM',price:12345,quantity:1}]};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(order.id,order.clientId,JSON.stringify(order));
 const paid={...order,shippedAt:'2026-11-10T21:00:00Z',id:'PRIVATE-PAID',legacyLv:{orderId:'old'},status:'redeemed',delivery:'cdek_pickup',redeemedAt:'2026-11-11T10:00:00Z'};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(paid.id,paid.clientId,JSON.stringify(paid));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{PATH:process.env.PATH,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3398'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const cookies={};for(const id of ['admin','head','operator','buyer']){const r=await call('/api/auth/login',null,{login:id,password:'synthetic-statistics-2026'});assert.equal(r.status,200,r.text);cookies[id]=r.headers.get('set-cookie').split(';')[0];}
 const basePath='/api/operator-statistics?section=base';
 assert.equal((await call(basePath)).status,401);
 assert.equal((await call(basePath,cookies.head)).status,403);
 assert.equal((await call(basePath,cookies.operator)).status,403);
 assert.equal((await call(basePath+'&actorId=admin',cookies.head)).status,403);
 const baseResponse=await call(basePath,cookies.admin);assert.equal(baseResponse.status,200,baseResponse.text);
 assert.equal(JSON.parse(baseResponse.text).rows.find(r=>r.id==='other').clients,1);
 assert.ok(!baseResponse.text.includes('private-client'));

 const buyerPath='/api/operator-statistics?section=shipped&from=2026-11-11&to=2026-11-11';
 const buyerResponse=await call(buyerPath,cookies.buyer);assert.equal(buyerResponse.status,200,buyerResponse.text);
 const buyerRow=JSON.parse(buyerResponse.text).rows.find(r=>r.id==='other');assert.equal(buyerRow.sentAmount,12345);assert.equal(buyerRow.sentCdek,1);assert.equal(buyerRow.redeemed,1);
 assert.deepEqual(Object.keys(buyerRow).sort(),['id','label','sentCdek','sentPost','sentMoscow','sent','sentAmount','redeemed','returned'].sort());
 for(const secret of ['PRIVATE-PAID','PRIVATE-ORDER','private-client','PRIVATE CLIENT','PRIVATE ITEM','79990000001','orderLists'])assert.ok(!buyerResponse.text.includes(secret));
 for(const section of ['base','created','buyouts','confirmation',''])assert.equal((await call('/api/operator-statistics?section='+section,cookies.buyer)).status,403);
 assert.equal((await call(buyerPath+'&actorId=admin',cookies.buyer)).status,403);
 const buyerDaily=await call(buyerPath+'&groupBy=day&department=2',cookies.buyer);assert.equal(buyerDaily.status,200);assert.equal(JSON.parse(buyerDaily.text).rows[0].label,'2026-11-11');
 assert.equal(JSON.parse((await call(buyerPath+'&department=1',cookies.buyer)).text).rows.length,0);
 const path='/api/operator-statistics?from=2026-11-11&to=2026-11-11';
 assert.equal((await call(path)).status,401);
 assert.equal((await call(path,cookies.operator)).status,403);
 for(const id of ['admin','head']){
  const response=await call(path,cookies[id]);assert.equal(response.status,200,response.text);
  const row=JSON.parse(response.text).rows.find(r=>r.id==='other');assert.equal(row.created,1);assert.equal(row.inWork,1);assert.equal(row.awaitingShipment,0);assert.equal(row.amount,12345);assert.equal(row.department,'2');
  assert.deepEqual(Object.keys(row).sort(),['id','login','department','inWork','created','amount','average','cancelled','confirmed','confirmedAmount','awaitingShipment','sent','buyoutCount','buyoutAmount','buyoutCdek','buyoutPost','buyoutMoscow'].sort());
  assert.equal(row.buyoutCdek,1);assert.equal(row.buyoutPost,0);assert.equal(row.buyoutMoscow,0);
  for(const privateValue of ['PRIVATE-PAID','PRIVATE-ORDER','private-client','PRIVATE CLIENT','PRIVATE ITEM','79990000001'])assert.ok(!response.text.includes(privateValue));
 }
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify({...order,confirmedAt:'2026-11-12T10:00:00Z'}),order.id);
 const confirmedResponse=await call(path,cookies.head);assert.equal(confirmedResponse.status,200);
 const confirmedRow=JSON.parse(confirmedResponse.text).rows.find(r=>r.id==='other');assert.equal(confirmedRow.confirmed,1);assert.equal(confirmedRow.confirmedAmount,12345);
 for(const secret of ['PRIVATE-ORDER','PRIVATE ITEM','private-client','orderLists'])assert.ok(!confirmedResponse.text.includes(secret));
 db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(order),order.id);
 assert.equal((await call(path+'&actorId=admin',cookies.head)).status,403);
 assert.equal((await call('/api/operator-statistics?from=bad',cookies.head)).status,400);
 const empty=await call('/api/operator-statistics?from=2026-11-12&to=2026-11-12',cookies.head);assert.ok(JSON.parse(empty.text).rows.every(r=>r.created===0));
 const dailyPath='/api/operator-statistics?groupBy=day&department=2&from=2026-11-11&to=2026-11-11';
 assert.equal((await call(dailyPath,cookies.operator)).status,403);
 const dailyResponse=await call(dailyPath,cookies.head);assert.equal(dailyResponse.status,200,dailyResponse.text);
 const dailyRows=JSON.parse(dailyResponse.text).rows;assert.equal(dailyRows.length,1);assert.equal(dailyRows[0].login,'2026-11-11');assert.equal(dailyRows[0].buyoutCdek,1);assert.equal(dailyRows[0].buyoutAmount,12345);
 for(const secret of ['PRIVATE-PAID','PRIVATE CLIENT','79990000001','orderLists'])assert.ok(!dailyResponse.text.includes(secret));
 assert.equal(JSON.parse((await call(dailyPath.replace('department=2','department=1'),cookies.head)).text).rows.length,0);
 const shippedPath='/api/operator-statistics?section=shipped&groupBy=day&department=2&from=2026-11-11&to=2026-11-11';
 assert.equal((await call(shippedPath,cookies.operator)).status,403);
 const shippedResponse=await call(shippedPath,cookies.head);assert.equal(shippedResponse.status,200,shippedResponse.text);
 const shippedRows=JSON.parse(shippedResponse.text).rows;assert.equal(shippedRows.length,1);assert.equal(shippedRows[0].label,'2026-11-11');assert.equal(shippedRows[0].sentAmount,12345);assert.equal(shippedRows[0].sentCdek,1);assert.equal(shippedRows[0].sent,1);assert.equal(shippedRows[0].redeemed,1);
 assert.deepEqual(Object.keys(shippedRows[0]).sort(),['id','label','sentCdek','sentPost','sentMoscow','sent','sentAmount','redeemed','returned'].sort());
 for(const secret of ['PRIVATE-PAID','PRIVATE CLIENT','79990000001'])assert.ok(!shippedResponse.text.includes(secret));
 assert.equal(JSON.parse((await call(shippedPath.replace('department=2','department=1'),cookies.head)).text).rows.length,0);
 const delayed={...paid,id:'DELAYED-ACCEPTANCE',cdekTransferredAt:'2026-11-13T10:00:00Z',shippedAt:'2026-11-13T10:00:00Z',cdekAcceptedAt:'2026-11-16T10:00:00Z'};
 db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(delayed.id,delayed.clientId,JSON.stringify(delayed));
 const exportPath='/api/operator-statistics?section=shipped&groupBy=day&department=2';
 const originalExport=await call(exportPath+'&from=2026-11-13&to=2026-11-13',cookies.head);
 assert.equal(originalExport.status,200);assert.equal(JSON.parse(originalExport.text).rows[0].sentCdek,1);
 assert.equal(JSON.parse((await call(exportPath+'&from=2026-11-16&to=2026-11-16',cookies.head)).text).rows.length,0);
 assert.ok(!originalExport.text.includes(delayed.id));
 // Existing object-level access remains closed for another department's orders.
 assert.equal((await call('/api/order-access',cookies.head,{orderId:order.id})).status,403);
 const returned={...paid,id:'PRIVATE-RETURNED',status:'returned',returnedAt:'2026-11-17T10:00:00Z'};db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(returned.id,returned.clientId,JSON.stringify(returned));
 const withReturn=JSON.parse((await call(buyerPath,cookies.buyer)).text).rows.find(r=>r.id==='other');assert.equal(withReturn.sent,2);assert.equal(withReturn.redeemed,1);assert.equal(withReturn.returned,1);
 console.log('Statistics HTTP: head aggregates only, dates, role and identity checks, private orders inaccessible');
}catch(error){console.error(logs);throw error;}finally{if(server&&server.exitCode===null){server.kill();await once(server,'exit');}db.close();rmSync(dir,{recursive:true,force:true});}

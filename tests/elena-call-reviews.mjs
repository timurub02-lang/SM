import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initReviews,reviewPage,writeReview} from '../lib/call-reviews.ts';
import {mayCallEndpoint} from '../lib/permissions.ts';
const db=openDatabase(':memory:');
const elena={id:'E-45fa4ec3-eac',role:'purchasing',name:'Елена'};
const url=path=>new URL(path,'https://crm.test');
try{
 const adminAsElena={...elena,impersonation:{adminId:'admin',ownerRole:'admin'}};
 for(const actor of [elena,adminAsElena,{...elena,impersonation:{ownerRole:'department_head'}},{...adminAsElena,id:'other'},{...elena,id:'other'},{...elena,role:'admin'},{...elena,role:'operator'}]){
  for(const [path,method] of [['/api/call-reviews','GET'],['/api/call-reviews','POST'],['/api/call-history/recording?review=1','GET']]){
   assert.equal(mayCallEndpoint(actor,url(path),method,{}),actor===elena||actor===adminAsElena);
  }
 }
 assert.equal(mayCallEndpoint(elena,url('/api/call-history'),'GET',{}),false);
 for(const sql of ['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)','CREATE TABLE client_phone_index(client_id TEXT,phone TEXT)'])await db.prepare(sql).run();
 await initReviews(db);
 await db.prepare('INSERT INTO clients VALUES(?,?)').bind('c',JSON.stringify({name:'Алёна Соколова'})).run();
 await db.prepare("INSERT INTO client_phone_index VALUES('c','79990000000')").run();
 await db.prepare("INSERT INTO orders VALUES('SK-123','c','{}')").run();
 const id='a'.repeat(32),second='b'.repeat(32),masked='c'.repeat(32);
 for(const [call,order,at] of [[id,null,'2026-11-23T20:59:00Z'],[second,'SK-123','2026-11-23T21:01:00Z']]){
  await db.prepare("INSERT INTO phone_calls(id,client_id,order_id,actor_id,actor_name,caller_number,started_at,status,recording) VALUES(?,'c',?,'op','Антон','',?,'completed',1)").bind(call,order,at).run();
 }
 await db.prepare("INSERT INTO replacement_numbers(number,added_at) VALUES('p','now')").run();
 await db.prepare("INSERT INTO replacement_assignments(id,number,order_id,client_id,client_name,assigned_at) VALUES('r','p','SK-123','c','Алёна','now')").run();
 await db.prepare("INSERT INTO replacement_calls(id,assignment_id,order_id,caller_number,destination,direction,claimed_at,recording) VALUES(?,'r','SK-123','','','to_client','2026-11-24T12:00:00Z',1)").bind(masked).run();
 const list=q=>reviewPage(db,new URLSearchParams(q));
 assert.equal((await list({q:'алена'})).pending,3);
 assert.equal((await list({q:'8 (999) 000-00-00'})).pending,3);
 assert.equal((await list({order:'SK-123',from:'2026-11-24',until:'2026-11-24'})).pending,2);
 assert.equal((await list({employee:'антон'})).pending,2);
 assert.ok(await writeReview(db,'phone',id,'Проверено',null,elena));
 assert.equal(await writeReview(db,'phone',id,'Повтор',null,elena),false);
 assert.equal(await writeReview(db,'masked',id,'Ошибка',null,elena),false);
 const page=await list({client:'c',status:'done'}),r=page.rows[0];
 assert.equal(page.pending,2);assert.equal(r.note,'Проверено');assert.equal(r.at,'2026-11-23T20:59:00Z');assert.ok(r.reviewedAt);
 assert.ok(await writeReview(db,'phone',id,'Уточнение',r.revision,elena));
 assert.equal((await list({status:'done'})).rows[0].reviewedAt,r.reviewedAt);
 assert.ok(await writeReview(db,'masked',masked,'',null,elena));
 console.log('Personal access, recordings, search, Moscow dates and independent review notes passed');
}finally{db.close();}

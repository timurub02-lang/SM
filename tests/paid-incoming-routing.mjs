import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initIncoming,incomingRouting,routePaidIncomingToOwners,readIncoming} from '../lib/incoming.ts';
import {initPhone} from '../lib/phone-store.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of ['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT,data TEXT,version INTEGER DEFAULT 1)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT,version INTEGER DEFAULT 1)','CREATE TABLE auth_accounts(employee_id TEXT PRIMARY KEY,enabled INTEGER)'])await d.prepare(sql).run();
 const staff=[{id:'op',name:'Owner',role:'operator',department:'1'},{id:'head',role:'department_head',department:'1'},{id:'buyer',role:'redemption'},{id:'buyer2',role:'redemption'},{id:'log',role:'logistic'}];
 for(const e of staff){await d.prepare('INSERT INTO employees VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();await d.prepare('INSERT INTO auth_accounts VALUES(?,1)').bind(e.id).run();}
 await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c','1',JSON.stringify({id:'c',owner:'op'})).run();
 const order={id:'paid',clientId:'c',manager:'op',status:'redeemed',delivery:'cdek_pickup'};
 await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('paid','c',JSON.stringify(order)).run();
 await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('new','c',JSON.stringify({...order,id:'new',status:'rework'})).run();
 await initIncoming(d);await initPhone(d);
 const claim=async(id,actor,orderId,at)=>d.prepare('INSERT INTO phone_calls(id,client_id,order_id,actor_id,actor_name,caller_number,started_at,status,claimed_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'c',orderId,actor,actor,'',at,'completed',at).run();
 await claim('buyout-call','buyer','paid','2026-11-13T08:19:00Z');
 let route=await incomingRouting(d,'c',{owner:'op'},'2026-11-13T08:26:00Z');
 assert.equal(route.assignee.id,'op');assert.equal(route.paidCallback,true);assert.equal(route.callbackOrderId,'paid');
 await claim('log-call','log','paid','2026-11-13T08:20:00Z');
 route=await incomingRouting(d,'c',{owner:'op'},'2026-11-13T08:26:00Z');assert.equal(route.assignee.id,'op','Paid order beats last logistics caller even with a new rework order');
 route=await incomingRouting(d,'c',{},'2026-11-13T08:26:00Z');assert.equal(route.shared,true);assert.equal(route.assignee,undefined,'No owner means shared head queue');
 await d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='op'").run();
 route=await incomingRouting(d,'c',{owner:'op'},'2026-11-13T08:26:00Z');assert.equal(route.shared,true);assert.equal(route.assignee,undefined,'Disabled owner is not a callable assignee');
 await d.prepare("UPDATE auth_accounts SET enabled=1 WHERE employee_id='op'").run();
 for(const [id,pinned,closed,handoff] of [['legacy',null,null,''],['pinned','paid',null,''],['closed',null,'done',''],['delegated',null,null,JSON.stringify({by:'admin',comment:'explicit'})],['active-order','new',null,'']])await d.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,order_id,closed_at,handoff) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'c','buyer','','2026-11-13T08:26:00Z','1','2',pinned,closed,handoff).run();
 const beforeOrders=JSON.stringify((await d.prepare('SELECT * FROM orders ORDER BY id').all()).results),beforeClient=(await d.prepare("SELECT data FROM clients WHERE id='c'").first()).data;
 await routePaidIncomingToOwners(d);await routePaidIncomingToOwners(d);
 for(const id of ['legacy','pinned']){const r=await d.prepare('SELECT * FROM incoming_calls WHERE id=?').bind(id).first();assert.equal(r.assignee_id,'op');assert.equal(r.department_id,'1');assert.equal(r.closed_at,null);}
 for(const id of ['closed','delegated','active-order'])assert.equal((await d.prepare('SELECT assignee_id FROM incoming_calls WHERE id=?').bind(id).first()).assignee_id,'buyer',id+' is preserved');
 for(const buyer of staff.filter(e=>e.role==='redemption'))assert.ok(!(await readIncoming(d,buyer,staff,[])).some(r=>['legacy','pinned'].includes(r.id)),'Paid callback leaves all buyout queues');
 assert.ok((await readIncoming(d,staff[0],staff,[])).some(r=>r.id==='legacy'));assert.ok((await readIncoming(d,staff[1],staff,[])).some(r=>r.id==='legacy'));
 assert.equal(JSON.stringify((await d.prepare('SELECT * FROM orders ORDER BY id').all()).results),beforeOrders);assert.equal((await d.prepare("SELECT data FROM clients WHERE id='c'").first()).data,beforeClient);
 await d.prepare("UPDATE orders SET data=json_set(data,'$.status','shipping') WHERE id='paid'").run();
 await claim('active-buyout','buyer','paid','2026-11-13T09:00:00Z');
 route=await incomingRouting(d,'c',{owner:'op'},'2026-11-13T09:01:00Z');assert.equal(route.assignee.id,'buyer');assert.equal(route.paidCallback,false,'Unpaid shipped order stays with buyout');
 console.log('Paid incoming: owner priority, shared fallback, paid legacy/pinned repair, closed/handoff/other-order guards, buyout isolation and unchanged clients/orders passed');
}finally{d.close();}

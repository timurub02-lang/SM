import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initIncoming,readIncoming,seesIncoming,incomingForAction,incomingCloseStatement,activeIncomingOrder} from '../lib/incoming.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)'].map(s=>d.prepare(s)));
 const staff=[{id:'admin',role:'admin'},{id:'head1',role:'department_head',department:'1'},{id:'head2',role:'department_head',department:'2'},{id:'head0',role:'department_head',department:''},{id:'one',role:'operator',department:'1'},{id:'two',role:'operator',department:'2'},{id:'logistic',role:'logistic'},{id:'courier',role:'courier'}];
 for(const e of staff)await d.prepare('INSERT INTO employees VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare('INSERT INTO clients VALUES(?,?)').bind('known',JSON.stringify({id:'known',name:'Known'})).run();
 await initIncoming(d);
 const unknown={id:'unknown',client_id:null,assignee_id:null,department_id:''};
 const known={id:'known',client_id:'known',assignee_id:'one',department_id:'1'};
 const unassigned={id:'unassigned',client_id:'known',assignee_id:null,department_id:''};
 for(const r of [unknown,known,unassigned])await d.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number) VALUES(?,?,?,?,?,?,?)').bind(r.id,r.client_id,r.assignee_id,r.department_id,'2026-10-13T10:00:00Z','+79990000001','+79990000002').run();
 for(const e of staff){
  const items=await readIncoming(d,e,staff,[]);
  for(const item of items){
   const hidden=['operator','department_head'].includes(e.role);
   assert.equal(item.phone,hidden?'':'+79990000001',e.id+' caller phone privacy');
   assert.equal(item.calledNumber,hidden?'':'+79990000002',e.id+' receiving phone privacy');
  }
  assert.equal(items.some(i=>i.id==='unknown'),['admin','department_head'].includes(e.role),e.id+' unknown caller visibility');
  for(const r of [unknown,known,unassigned])assert.equal(items.some(i=>i.id===r.id),seesIncoming(r,e,staff),e.id+' read/action consistency');
 }
 await assert.rejects(incomingForAction(d,'unknown',staff[4],staff),/недоступно/);
 await incomingForAction(d,'unknown',staff[2],staff);
 const first=await incomingCloseStatement(d,'unknown','head2','2026-10-13T11:00:00Z','Связались, вопрос решён',null).run();
 const second=await incomingCloseStatement(d,'unknown','head1','2026-10-13T11:01:00Z','Другой ответ',null).run();
 assert.equal(first.meta.changes,1);assert.equal(second.meta.changes,0,'Concurrent close must not overwrite first result');
 for(const e of staff.filter(e=>['admin','department_head'].includes(e.role))){
  const row=(await readIncoming(d,e,staff,[])).find(i=>i.id==='unknown');assert.ok(row.closedAt,'Closed for everyone');assert.equal(row.reason,'Связались, вопрос решён');
  await assert.rejects(incomingForAction(d,'unknown',e,staff),/уже закрыто/);
 }
 assert.equal(activeIncomingOrder({status:'draft'}),true);assert.equal(activeIncomingOrder({status:'redeemed'}),false);
 const orders=[{id:'a-own',clientId:'known',manager:'one',status:'draft'},{id:'z-foreign',clientId:'known',manager:'two',status:'confirm'},{id:'m-own',clientId:'known',manager:'one',status:'shipping'},{id:'closed',clientId:'known',manager:'one',status:'redeemed'},{id:'unrelated',clientId:'elsewhere',manager:'one',status:'draft'}];
 const namedStaff=staff.map(e=>({...e,name:'Name '+e.id}));
 for(const order of orders)await d.prepare('INSERT INTO orders VALUES(?,?,?)').bind(order.id,order.clientId,JSON.stringify(order)).run();
 const full=await readIncoming(d,namedStaff[4],namedStaff,orders),scoped=await readIncoming(d,namedStaff[4],namedStaff,[],true);
 assert.deepEqual(full.find(i=>i.id==='known').orderIds,['a-own','m-own'],'global order input order is retained');
 assert.deepEqual(scoped.find(i=>i.id==='known').orderIds,['m-own','a-own'],'scoped SQL order is retained');
 assert.equal(full.find(i=>i.id==='known').phone,'');assert.equal(full.find(i=>i.id==='known').assigneeName,'Name one');
 const hidden=(await readIncoming(d,namedStaff[4],namedStaff,[orders[1]])).find(i=>i.id==='known');
 assert.equal(hidden.hasActiveOrder,true,'a hidden active order still prevents treating the incoming client as idle');assert.deepEqual(hidden.orderIds,[],'hidden order identifiers remain private');
 const firstRead=await readIncoming(d,namedStaff[0],namedStaff,orders);firstRead.find(i=>i.id==='known').orderIds.push('mutated');
 assert.ok(!(await readIncoming(d,namedStaff[0],namedStaff,orders)).find(i=>i.id==='known').orderIds.includes('mutated'),'each response owns its order ID array');
 let statusReads=0;await readIncoming(d,namedStaff[0],namedStaff,orders.map(order=>({...order,get status(){statusReads++;return order.status;}})));
 assert.equal(statusReads,4,'active status is evaluated once per relevant order, not once per incoming row');
 console.log('Incoming: unknown callers visible to all heads, including no department; known clients scoped; read/action parity; shared atomic closure passed.');
}finally{d.close();}

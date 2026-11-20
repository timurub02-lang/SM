import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initIncoming,markIncomingMissed,readIncoming,canPlayMissedRecording} from '../lib/incoming.ts';
import {initMissedHistory} from '../lib/incoming-missed-history.ts';
import {incomingCounts,incomingIsMissed} from '../lib/incoming-status.ts';
const d=openDatabase(':memory:'),now='2026-11-17T10:00:00.000Z',until='2026-11-17T11:00:00.000Z';
try{
 for(const sql of ['CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT,version INTEGER DEFAULT 1)','CREATE TABLE auth_accounts(employee_id TEXT,enabled INTEGER)','CREATE TABLE events(id TEXT PRIMARY KEY,client_id TEXT,order_id TEXT,at TEXT,data TEXT)'])await d.prepare(sql).run();
 const staff=['admin','operator','department_head','logistic','chief_logistic','redemption','courier','purchasing'].map(role=>({id:role,role,name:'Test '+role,department:'1'}));
 for(const e of staff)await d.prepare('INSERT INTO employees VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare("INSERT INTO clients VALUES('c',?)").bind(JSON.stringify({id:'c',owner:'operator'})).run();
 await d.prepare("INSERT INTO orders(id,client_id,data) VALUES('o','c',?)").bind(JSON.stringify({id:'o',clientId:'c',manager:'operator',status:'shipping'})).run();
 await initIncoming(d);
 const beforeOrders=JSON.stringify((await d.prepare('SELECT * FROM orders').all()).results),beforeClients=JSON.stringify((await d.prepare('SELECT * FROM clients').all()).results);
 for(const e of staff.slice(0,6)){
  await d.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number) VALUES(?,?,?,?,?,?,?)').bind(e.id,'c',e.id,'1',now,'1','2').run();
  assert.equal(await markIncomingMissed(d,e.id,e,staff,now),until);
  assert.equal(await markIncomingMissed(d,e.id,e,staff,'2026-11-17T10:15:00.000Z'),until,'Retry never extends the cooldown');
  const item=(await readIncoming(d,e,staff,[])).find(i=>i.id===e.id);
  assert.deepEqual(item.missedHistory.map(m=>[m.at,m.name]),[[now,e.name]]);assert.equal(item.missedAt,now);assert.equal(item.missedBy,e.id);assert.equal(item.missedName,e.name);assert.equal(item.closedAt,'');assert.equal(item.assigneeId,e.id);
  assert.equal(incomingIsMissed(item,Date.parse(until)-1),true);assert.equal(incomingIsMissed(item,Date.parse(until)),false);
 }
 assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,6,'One audit entry per attempt');
 const e=staff[1],recording='1'.repeat(32),unrelated='2'.repeat(32);
 for(const [id,request] of [[recording,e.id],[unrelated,'other']]){
  await d.prepare("INSERT INTO phone_calls(id,client_id,actor_id,actor_name,caller_number,started_at,status,recording) VALUES(?,'c',?,?,'',?,'completed',0)").bind(id,e.id,e.name,'2026-11-17T10:59:00.000Z').run();
  await d.prepare('INSERT INTO phone_call_incoming VALUES(?,?)').bind(id,request).run();
 }
 await markIncomingMissed(d,e.id,e,staff,until,unrelated);
 assert.equal(await canPlayMissedRecording(d,e,e.id,recording),false);
 await d.prepare('UPDATE phone_calls SET recording=1').run();
 let history=(await readIncoming(d,e,staff,[])).find(i=>i.id===e.id).missedHistory;
 assert.deepEqual(history.map(m=>[m.at,m.recording]),[[until,recording],[now,undefined]]);
 assert.equal(await canPlayMissedRecording(d,e,e.id,recording),true);
 assert.equal(await canPlayMissedRecording(d,e,e.id,unrelated),false);
 assert.equal(await canPlayMissedRecording(d,{...e,id:'foreign'},e.id,recording),false);

 assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,7,'New attempt after one hour is recorded');
 for(const denied of [staff[6],staff[7],{...e,id:'foreign'}])await assert.rejects(markIncomingMissed(d,'operator',denied,staff,now),/недоступно/);
 await d.prepare("UPDATE incoming_calls SET closed_at=? WHERE id='operator'").bind(now).run();await assert.rejects(markIncomingMissed(d,'operator',e,staff,now),/закрыто/);
 await d.prepare("UPDATE incoming_calls SET spam=1 WHERE id='admin'").run();await assert.rejects(markIncomingMissed(d,'admin',staff[0],staff,now),/спама/);
 await d.prepare("INSERT INTO incoming_calls(id,assignee_id,department_id,at,phone,called_number) VALUES('unknown','department_head','1',?,'1','2')").bind(now).run();
 await markIncomingMissed(d,'unknown',staff[2],staff,now);
 assert.ok((await readIncoming(d,staff[2],staff,[])).some(i=>i.id==='unknown'&&i.missedUntil===until&&!i.clientId),'Unknown client is kept in its category');
 // The same client can call again after closure. Attempts and recordings belong to each request.
 const tomorrow='2026-11-18T10:00:00.000Z';
 await d.prepare("INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number) VALUES('next','c','operator','1',?,'1','2')").bind(tomorrow).run();
 const next=async()=>(await readIncoming(d,e,staff,[])).find(i=>i.id==='next');
 assert.equal((await next()).missedHistory?.length||0,0);
 const clientCall='3'.repeat(32);
 await d.prepare("INSERT INTO phone_calls(id,client_id,actor_id,actor_name,caller_number,started_at,status,recording) VALUES(?,'c',?,?,'',?,'completed',1)").bind(clientCall,e.id,e.name,tomorrow).run();
 await markIncomingMissed(d,'next',e,staff,tomorrow,clientCall);
 assert.deepEqual((await next()).missedHistory,[{at:tomorrow,name:e.name,recording:clientCall}]);
 assert.equal(await canPlayMissedRecording(d,e,'next',recording),false);
 // Simulate the pre-history schema and recover only uniquely attributable old events.
 await d.prepare('DROP TRIGGER incoming_log_missed').run();
 await d.prepare('DROP TABLE incoming_missed_history').run();
 await initMissedHistory(d);
 await initMissedHistory(d);
 assert.equal((await next()).missedHistory.length,1);
 const early='2026-11-18T10:30:00.000Z';
 await d.prepare("UPDATE incoming_calls SET missed_at=? WHERE id='next'").bind('2026-11-18T12:00:00.000Z').run();
 await d.prepare("INSERT INTO events VALUES('INCOMING-ND-old','c','',?,?)").bind(early,JSON.stringify({actorId:e.id,actor:e.name})).run();
 await d.prepare('DROP TRIGGER incoming_log_missed').run();await initMissedHistory(d);
 assert.deepEqual((await next()).missedHistory.map(m=>m.at),['2026-11-18T12:00:00.000Z',early,tomorrow]);
 const oldUnknown=(await readIncoming(d,staff[2],staff,[])).find(i=>i.id==='unknown');
 assert.equal(oldUnknown.missedHistory.length,1);
 const sample=[...Array.from({length:3},()=>({})),...Array.from({length:4},()=>({missedUntil:until})),{closedAt:now},{spam:true}];
 assert.deepEqual(incomingCounts(sample,Date.parse(now)),{ready:3,missed:4});assert.deepEqual(incomingCounts(sample,Date.parse(until)),{ready:7,missed:0});
 assert.equal(JSON.stringify((await d.prepare('SELECT * FROM orders').all()).results),beforeOrders);assert.equal(JSON.stringify((await d.prepare('SELECT * FROM clients').all()).results),beforeClients);
 console.log('Incoming ND: all six roles, one-hour boundary, 3/4 counters, retry, repeat attempt, permissions, unknown, closed/spam and unchanged clients/orders passed');
}finally{d.close();}

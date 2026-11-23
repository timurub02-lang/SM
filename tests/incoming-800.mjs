import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {receiveIncoming800,incoming800Http,initIncoming800,Incoming800Conflict} from '../lib/incoming-800.ts';
import {readIncoming,receiveIncoming} from '../lib/incoming.ts';
const d=openDatabase(':memory:'),at=new Date().toISOString();
const event=(callId,phone='+79990000001')=>({v:1,node:'fixture-pbx',callId,route:'megafon',phone,calledNumber:'+78000000001',at});
const admin={id:'admin',role:'admin'},env={CRM_INCOMING_800_ENABLED:'1',CRM_INCOMING_800_KEY:'synthetic-key-800-12345678901234567890',CRM_INCOMING_800_NODE:'fixture-pbx',CRM_INCOMING_800_ROUTES:JSON.stringify({megafon:'+78000000001'})};
const request=(body=event('http'),key=env.CRM_INCOMING_800_KEY)=>new Request('http://localhost/api/telephony/incoming-800',{method:'POST',headers:{'x-crm-incoming-key':key},body:typeof body==='string'?body:JSON.stringify(body)});
try{
 for(const sql of readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare('CREATE TABLE auth_accounts(employee_id TEXT,enabled INTEGER)').run();
 assert.equal((await incoming800Http(request(),()=>{throw Error('Must not open DB');},{})).status,404);
 assert.equal((await incoming800Http(request(undefined,'wrong'),()=>d,env)).status,403);
 assert.equal((await incoming800Http(request(),()=>d,{...env,CRM_INCOMING_800_ROUTES:'{}'})).status,503);
 assert.equal((await incoming800Http(request({...event('bad'),node:'other'}),()=>d,env)).status,403);
 assert.equal((await incoming800Http(request({...event('bad'),calledNumber:'+78000000002'}),()=>d,env)).status,403);
 assert.equal((await incoming800Http(request({...event('bad'),screening:'passed'}),()=>d,env)).status,400);
 assert.equal((await incoming800Http(request('x'.repeat(4097)),()=>d,env)).status,413);
 assert.equal((await incoming800Http(request({...event('future'),at:new Date(Date.now()+120000).toISOString()}),()=>d,env)).status,400);
 await initIncoming800(d);
 // Same delivery concurrently and after a lost acknowledgement only applies once.
 const receipts=await Promise.all(Array.from({length:12},()=>receiveIncoming800(d,event('same'))));
 assert(receipts.every(r=>r.disposition==='accepted'&&r.requestId===receipts[0].requestId));
 let rows=await readIncoming(d,admin,[],[]);
 assert.equal(rows.length,1);assert.equal(rows[0].callCount,1);assert.equal(rows[0].source,'МегаФон · 8-800');assert(rows[0].sharedQueue);
 await assert.rejects(receiveIncoming800(d,{...event('same'),phone:'+79990000002'}),Incoming800Conflict);
 const response=await incoming800Http(request({...event('same'),phone:'+79990000002'}),()=>d,env);assert.equal(response.status,409);
 await Promise.all(Array.from({length:8},(_,i)=>receiveIncoming800(d,event('repeat-'+i))));
 rows=await readIncoming(d,admin,[],[]);assert.equal(rows.length,1);assert.equal(rows[0].callCount,9);
 // Manual assignment survives a new call; duplicate after closure does not reopen it.
 await d.prepare("UPDATE incoming_calls SET assignee_id='manual',shared_queue=0 WHERE id=?").bind(receipts[0].requestId).run();
 assert.equal((await receiveIncoming800(d,event('assigned-repeat'))).requestId,receipts[0].requestId);
 assert.equal((await d.prepare('SELECT assignee_id FROM incoming_calls').first()).assignee_id,'manual');
 await d.prepare('UPDATE incoming_calls SET closed_at=?').bind(at).run();
 assert.equal((await receiveIncoming800(d,event('same'))).requestId,receipts[0].requestId);
 assert.notEqual((await receiveIncoming800(d,event('after-close'))).requestId,receipts[0].requestId);
 assert.equal((await receiveIncoming800(d,event('withheld',''))).reason,'missing_caller');
 assert.equal((await receiveIncoming800(d,event('foreign','+12025550123'))).disposition,'review');
 await d.prepare("INSERT INTO incoming_phone_policy VALUES(?,'block','admin',?)").bind('+79990000002',at).run();
 assert.equal((await receiveIncoming800(d,event('blocked','+79990000002'))).disposition,'blocked');
 // The existing non-800 policy must still screen unknown numbers.
 await receiveIncoming(d,{id:'legacy-unknown',phone:'+79990000003',calledNumber:'+79990000000',at});
 assert.equal(await d.prepare("SELECT id FROM incoming_calls WHERE id='legacy-unknown'").first(),null);
 // Resolve a known client's owner through the current CRM rules, including linked phones.
 const operator={id:'operator',role:'operator',department:'dep',name:'Fixture'};
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(operator.id,JSON.stringify(operator)).run();
 await d.prepare('INSERT INTO auth_accounts VALUES(?,1)').bind(operator.id).run();
 await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('known','+79990000004',JSON.stringify({id:'known',owner:operator.id,linkedPhones:['+79990000005']})).run();
 const known=await receiveIncoming800(d,event('known','+79990000005'));
 assert.deepEqual({...await d.prepare('SELECT client_id,assignee_id,department_id FROM incoming_calls WHERE id=?').bind(known.requestId).first()},{client_id:'known',assignee_id:'operator',department_id:'dep'});
 // A write error rolls back both receipt and callback, so retry remains possible.
 await d.prepare("CREATE TRIGGER fixture_failure BEFORE INSERT ON incoming_calls WHEN NEW.phone='+79990000006' BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await incoming800Http(request(event('rollback','+79990000006')),()=>d,env)).status,503);
 assert.equal((await d.prepare("SELECT count(*) n FROM incoming_800_events WHERE json_extract(payload,'$.callId')='rollback'").first()).n,0);
 await d.prepare('DROP TRIGGER fixture_failure').run();
 assert.equal((await incoming800Http(request(event('rollback','+79990000006')),()=>d,env)).status,200);
 assert.equal((await d.prepare("SELECT count(*) n FROM incoming_800_events WHERE disposition='pending'").first()).n,0);
 console.log('8-800: gated/authenticated intake, durable idempotent receipts, concurrent merge, routing, blocked/review, rollback and legacy screening passed');
}finally{d.close();}

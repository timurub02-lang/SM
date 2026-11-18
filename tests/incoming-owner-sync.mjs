import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {authSchema} from '../lib/auth-schema.ts';
import {initIncoming,readIncoming} from '../lib/incoming.ts';
import {reconcileIncomingOwners} from '../lib/incoming-owner-sync.ts';
import {readIncomingWorkGate} from '../lib/incoming-work-gate.ts';
import {notificationSections} from '../lib/notification-sections.ts';
import {popupNotifications} from '../lib/notification-popups.ts';
process.env.NEXT_PUBLIC_CRM_INCOMING_WORK_GATE='1';
const d=openDatabase(':memory:'),at='2026-11-18T11:45:00.000Z',orderAt='2026-11-18T11:53:00.000Z',now='2026-11-18T12:00:00.000Z';
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 for(const sql of authSchema)await d.prepare(sql).run();
 const staff=[['old','operator','1'],['owner','operator','2'],['logistic','logistic',''],['redemption','redemption',''],['head','department_head','2']].map(([id,role,department])=>({id,role,department,name:id,login:id}));
 for(const e of staff){await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();await d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').bind(e.id,'synthetic-only').run();}
 await initIncoming(d);
 const handoff={by:'head',name:'Head',at,comment:'Original call details',freeClient:true};
 async function fixture(id,{handoffPatch={},assignee='old',status='draft',createdAt=orderAt,closed=null,spam=0,manager='owner',owner='owner',noOrder=false}={}){
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(id,id,JSON.stringify({id,name:id,owner})).run();
  if(!noOrder)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(id,id,JSON.stringify({id,clientId:id,manager,status,createdAt,items:[]})).run();
  await d.prepare('INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,handoff,missed_at,missed_by,missed_until,closed_at,spam) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,id,assignee,'1',at,'phone','called',JSON.stringify({...handoff,...handoffPatch}),at,'old','2026-11-18T12:45:00.000Z',closed,spam).run();
 }
 await fixture('sync');await fixture('explicit',{handoffPatch:{freeClient:false}});await fixture('legacy',{handoffPatch:{freeClient:undefined}});await fixture('closed',{closed:now});await fixture('spam',{spam:1});await fixture('logistic',{assignee:'logistic'});await fixture('redemption',{assignee:'redemption'});await fixture('paid',{status:'redeemed'});await fixture('old-order',{createdAt:'2026-11-01T00:00:00Z'});await fixture('different-author',{manager:'old'});await fixture('no-order',{noOrder:true});await fixture('same-owner',{owner:'old',manager:'old'});
 const clients=JSON.stringify((await d.prepare('SELECT * FROM clients ORDER BY id').all()).results),orders=JSON.stringify((await d.prepare('SELECT * FROM orders ORDER BY id').all()).results);
 const row=id=>d.prepare('SELECT * FROM incoming_calls WHERE id=?').bind(id).first();
 assert.equal(await reconcileIncomingOwners(d,'',now),1);
 const changed=await row('sync');assert.equal(changed.assignee_id,'owner');assert.equal(changed.department_id,'2');assert.equal(changed.missed_until,'');assert.equal(changed.missed_at,at);assert.equal(changed.missed_by,'old');assert.equal(changed.closed_at,null);
 const saved=JSON.parse(changed.handoff);assert.equal(saved.comment,handoff.comment);assert.equal(saved.by,'head');assert.equal(saved.at,at);assert.equal(saved.freeClient,false);assert.deepEqual(saved.ownerSync,{at:now,from:'old',to:'owner'});
 assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,1);assert.equal((await d.prepare('SELECT count(*) n FROM reminders').first()).n,1);
 const notice=JSON.parse((await d.prepare("SELECT data FROM reminders WHERE employee_id='old'").first()).data);assert.equal(notice.kind,'incoming-owner');assert.equal(notificationSections([], [notice]).events.length,1);assert.equal(notificationSections([], [notice]).tasks.length,0);assert.equal(popupNotifications([{id:'other',clientId:'sync'}],[notice]).some(r=>r.id===notice.id),true);
 for(const id of ['explicit','legacy','closed','spam','paid','old-order','different-author','no-order'])assert.equal((await row(id)).assignee_id,'old',id);
 assert.equal((await row('logistic')).assignee_id,'logistic');assert.equal((await row('redemption')).assignee_id,'redemption');assert.ok((await row('same-owner')).missed_until);assert.equal(JSON.parse((await row('same-owner')).handoff).freeClient,false,'First ownership acquisition consumes the free marker even without a transfer');
 assert.equal(await reconcileIncomingOwners(d,'',now),0,'Idempotent');
 assert.equal((await readIncomingWorkGate(d,staff[1],Date.parse(now))).incomingIds.includes('sync'),true,'New owner sees ready incoming, not ND');
 assert.equal((await readIncomingWorkGate(d,staff[0],Date.parse(now))).incomingIds.includes('sync'),false,'Old handler is released');
 assert.ok((await readIncoming(d,staff[4],staff,[])).some(i=>i.id==='sync'&&i.handoff.ownerSync.to==='owner'),'New owner department sees original comments and owner-sync audit');
 // A manual reassignment between read and write wins the CAS, with no phantom notice/event.
 await fixture('race');const originalBatch=d.batch.bind(d);let raced=false;
 d.batch=async statements=>{if(!raced){raced=true;await d.prepare("UPDATE incoming_calls SET handoff=? WHERE id='race'").bind(JSON.stringify({...handoff,freeClient:false,comment:'Explicit admin decision'})).run();}return originalBatch(statements);};
 assert.equal(await reconcileIncomingOwners(d,'race',now),0);d.batch=originalBatch;assert.equal((await row('race')).assignee_id,'old');assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,1);
 // A notification failure rolls back both the reassignment and audit.
 await fixture('rollback');await d.prepare("CREATE TRIGGER reject_notice BEFORE INSERT ON reminders BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 await assert.rejects(reconcileIncomingOwners(d,'rollback',now),/fixture failure/);assert.equal((await row('rollback')).assignee_id,'old');assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,1);
 await d.prepare('DROP TRIGGER reject_notice').run();
 await d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='owner'").run();assert.equal(await reconcileIncomingOwners(d,'rollback',now),0,'Disabled owner cannot receive work');
 assert.equal(JSON.stringify((await d.prepare('SELECT * FROM clients WHERE id NOT IN (\'race\',\'rollback\') ORDER BY id').all()).results),clients);assert.equal(JSON.stringify((await d.prepare('SELECT * FROM orders WHERE id NOT IN (\'race\',\'rollback\') ORDER BY id').all()).results),orders);
 console.log('Owner sync: free-only handoff, new active owner order, reset ND, preserved comments/audit, old-operator notification, correct head/gate, legacy/explicit/team exceptions, disabled/old/closed/paid guards, CAS, rollback, idempotence and unchanged clients/orders passed');
}finally{d.close();}

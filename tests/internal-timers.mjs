import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {internalDeadline,internalElapsed,upgradeOrderTimers} from '../lib/internal-timers.ts';
import {draftDeadline,confirmationDeadline,reworkDeadlineFrom,reworkTimeLeft} from '../lib/crm.ts';
import {courierToOperator,pauseCourierOperatorBudget} from '../lib/courier.ts';
import {defaultOrderPolicy} from '../lib/order-policy.ts';
import {operatorReturnDeadline,syncRedemption,initRedemption} from '../lib/redemption.ts';
import {openDatabase} from '../server/sqlite.ts';
import {reconcileOrderTimers} from '../lib/base-retention-store.ts';
const fri='2026-11-13T15:00:00.000Z',mon='2026-11-16T14:00:00.000Z';
assert.equal(internalDeadline(fri,23),mon); // Friday 18:00 Moscow -> Monday 17:00.
assert.equal(internalDeadline('2026-11-14T12:00:00Z',1),'2026-11-15T22:00:00.000Z');
assert.equal(internalDeadline(fri,24*10),'2026-11-27T15:00:00.000Z');
assert.equal(internalDeadline('2026-11-06T15:00:00Z',24),'2026-11-07T15:00:00.000Z'); // No retroactive refund.
assert.equal(draftDeadline({status:'draft',createdAt:fri,draftHours:23}),mon);
assert.equal(confirmationDeadline({status:'confirm',confirmationStartedAt:fri,confirmationHours:23}),mon);
assert.equal(confirmationDeadline({status:'extra',finalHandoffAt:fri,finalConfirmHours:23}),mon);
assert.equal(reworkDeadlineFrom(fri,23),mon);assert.equal(reworkDeadlineFrom(fri,null),undefined);
assert.equal(internalElapsed(Date.parse('2026-11-13T21:00:00Z'),Date.parse('2026-11-15T21:00:00Z')),0);
assert.equal(reworkTimeLeft(mon,Date.parse('2026-11-14T10:00:00Z')),reworkTimeLeft(mon,Date.parse('2026-11-15T10:00:00Z')));
const legacy={id:'old',version:1,status:'rework',reworkHours:23,reworkDeadline:'2026-11-14T14:00:00.000Z',createdAt:fri,updatedAt:fri,cdekStorageUntil:'2026-11-14',items:[{quantity:2,price:100}],manager:'op'};
const upgraded=upgradeOrderTimers(legacy);assert.equal(upgraded.reworkDeadline,mon);assert.strictEqual(upgradeOrderTimers(upgraded),upgraded);
assert.deepEqual(upgraded.items,legacy.items);assert.equal(upgraded.cdekStorageUntil,legacy.cdekStorageUntil);assert.equal(upgraded.updatedAt,legacy.updatedAt);
assert.strictEqual(upgradeOrderTimers({...legacy,status:'refused'}).timerCalendar,undefined);
const returned=courierToOperator({courier:{},status:'confirm'},'reason',{...defaultOrderPolicy,reworkHours:23},fri);
assert.equal(returned.reworkDeadline,mon);pauseCourierOperatorBudget(returned,'2026-11-16T00:00:00.000Z');assert.equal(returned.courier.operatorBudgetMs,14*3600000);
assert.equal(operatorReturnDeadline('',new Date(fri)),'2026-11-17T15:00:00.000Z');
assert.equal(operatorReturnDeadline('2026-11-14',new Date(fri)),'2026-11-14T20:59:59.999Z');
const db=openDatabase(':memory:'),originalNow=Date.now;
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
 await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('client','+79990000000',JSON.stringify({id:'client',owner:'op'})).run();
 const order={...legacy,clientId:'client',contact:'none',round:1,extra:false,items:[]};
 await db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(order.id,order.clientId,JSON.stringify(order)).run();
 Date.now=()=>Date.parse('2026-11-14T15:00:00Z');
 assert.equal(await reconcileOrderTimers(db,[order],[]),true);
 const row=await db.prepare('SELECT data,version FROM orders WHERE id=?').bind(order.id).first(),saved={...JSON.parse(row.data),version:row.version};
 assert.equal(saved.status,'rework');assert.equal(saved.reworkDeadline,mon);assert.equal(saved.version,2);
 assert.equal(await reconcileOrderTimers(db,[saved],[]),false);
 await initRedemption(db);
 const data={operatorReturn:{at:fri,durationHours:48,deadline:'2026-11-15T15:00:00.000Z'}};
 await db.prepare('INSERT INTO redemption_entries(order_id,entered_at,data) VALUES(?,?,?)').bind(order.id,fri,JSON.stringify(data)).run();
 await syncRedemption(db,new Date('2026-11-14T15:00:00Z'));
 let entry=JSON.parse((await db.prepare('SELECT data FROM redemption_entries').first()).data);
 assert.equal(entry.operatorReturn.deadline,'2026-11-14T20:59:59.999Z'); // External storage cap is never extended.
 assert.equal(entry.operatorReturn.resolvedAt,undefined);
 await syncRedemption(db,new Date('2026-11-14T21:00:00Z'));
 entry=JSON.parse((await db.prepare('SELECT data FROM redemption_entries').first()).data);assert.ok(entry.operatorReturn.resolvedAt);
 assert.equal(JSON.parse((await db.prepare('SELECT data FROM orders').first()).data).cdekStorageUntil,'2026-11-14');
}finally{Date.now=originalNow;db.close();}
console.log('Weekday timers: Moscow boundaries, existing-order CAS/idempotence, frozen weekends, courier budget and unchanged CDEK cap passed');

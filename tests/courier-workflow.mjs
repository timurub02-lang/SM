import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {applyCourierCommand,courierLabel,courierParcelLocation,courierToOperator,courierDeadline,courierStage,courierBalance,courierConfirmationStage,courierMissedCallTime,courierReminderNeedsAction} from '../lib/courier.ts';
import {allowedOrderTransitions,orderGroup,packingStage,applyRetention,scheduledCalls} from '../lib/crm.ts';
import {defaultOrderPolicy as policy} from '../lib/order-policy.ts';
import {reconcileOrderTimers} from '../lib/base-retention-store.ts';
import {inventorySQL,migrateCourierStock} from '../lib/inventory-sql.ts';
const hour=3600000,at=new Date().toISOString(),time=Date.parse(at),later=n=>new Date(time+n*hour).toISOString();
const courier={id:'driver',name:'Courier',role:'courier'},logistic={id:'logistic',name:'Logistic',role:'logistic'},operator={id:'operator',name:'Operator',role:'operator'};
const client={id:'client',name:'Client',phone:'+79990000111',owner:operator.id,source:'',sheet:'К',address:'Address',createdAt:at,version:1};
const base={id:'o',clientId:client.id,manager:operator.id,logistic:'',delivery:'moscow_courier',status:'packing',packingWaybillAt:at,createdAt:at,updatedAt:at,items:[{name:'Product',quantity:1,price:10000}],address:'Address',comment:'',reason:'',contact:'none',due:'',round:1,extra:false,version:1,courier:{id:courier.id,name:courier.name,assignedAt:at,phase:'pending',amount:10000}};
const moscowNow=Date.parse('2026-10-07T15:00:30Z'); // 18:00 Moscow, independent of the computer timezone.
assert.equal(courierMissedCallTime('18:01',moscowNow),'2026-10-07T15:01:00.000Z');
for(const t of ['','25:00','18:60','2026-10-08T18:00','17:00','18:00'])assert.throws(()=>courierMissedCallTime(t,moscowNow));
assert.equal(courierMissedCallTime('00:01',Date.parse('2026-10-31T21:00:00Z')),'2026-10-31T21:01:00.000Z');
assert.throws(()=>courierMissedCallTime('00:01',Date.parse('2026-10-31T20:59:00Z')));
const notice={id:'n',kind:'courier',orderId:base.id,clientId:client.id,title:'Event',text:'Author',at};
assert.equal(courierReminderNeedsAction(notice,base),true);
assert.equal(courierReminderNeedsAction({...notice,at:later(-1)},base),false);
assert.equal(courierReminderNeedsAction(notice,undefined),false);
const run=(o,e,operation,n=0,extra={})=>applyCourierCommand(o,{action:'courierWorkflow',operation,...extra},e,policy,later(n)).order;
assert.equal(courierDeadline(base),undefined);assert.equal(orderGroup(base.status).id,'accepted');assert.equal(packingStage(base),'exported');
assert.deepEqual(courierBalance([base],courier.id),{pending:10000,parcels:0,cash:0,total:0});
assert.throws(()=>run(base,courier,'confirm'));assert.throws(()=>applyCourierCommand(base,{action:'courierAccept',confirmed:true},{...courier,id:'other'},policy,at));
let accepted=applyCourierCommand(base,{action:'courierAccept',confirmed:true},courier,policy,later(100)).order;
assert.equal(courierStage(accepted),'confirmation');assert.equal(accepted.status,'packing');assert.equal(courierDeadline(accepted),later(148));assert.equal(courierBalance([accepted],courier.id).total,10000);
assert.equal(courierConfirmationStage(accepted,time+142*hour),'expiring');
assert.equal(courierReminderNeedsAction({...notice,at:later(100)},accepted),false,'Physical acceptance is history, not a new task');
const callOrder={...accepted,contact:'missed',due:later(101)},callNotice={...notice,kind:'call',due:callOrder.due,readAt:later(100)};
assert.equal(courierReminderNeedsAction(callNotice,callOrder,time+100*hour),true,'Reading a future call does not complete it');
assert.equal(courierReminderNeedsAction(callNotice,callOrder,time+102*hour),true,'Missed call stays overdue, never moves to tomorrow');
assert.equal(courierReminderNeedsAction(callNotice,{...callOrder,due:later(103)}),false,'Rescheduled call moves to history');
assert.equal(courierReminderNeedsAction({...callNotice,resolved:true},callOrder),false);
assert.equal(courierConfirmationStage({...accepted,contact:'callback',due:later(101)},time+101*hour),'new');
assert.throws(()=>run(accepted,logistic,'confirm',101));assert.throws(()=>run(accepted,courier,'confirm',149));
let sent=run(accepted,courier,'confirm',101);assert.equal(sent.status,'shipping');assert.equal(courierStage(sent),'delivery');assert.equal(courierDeadline(sent),undefined);
let work=run(sent,courier,'toOperator',102,{reason:'Questions'});assert.equal(work.status,'rework');assert.equal(work.courier.atDoor,false);assert.equal(courierStage(work),'waiting');assert.equal(work.reworkDeadline,later(198));
assert.equal(courierBalance([work],courier.id).parcels,10000);assert.equal(applyRetention(client,[work],time).owner,operator.id);
assert.deepEqual(allowedOrderTransitions(work,'operator'),['refused']);assert.deepEqual(allowedOrderTransitions(work,'logistic'),[]);
assert.throws(()=>run(work,courier,'confirm',103));
let resume=run(work,operator,'confirm',104);assert.equal(resume.courier.operatorBudgetMs,94*hour);assert.equal(resume.courier.operatorStartedAt,undefined);assert.equal(courierStage(resume),'pending');assert.equal(resume.courier.acceptedAt,accepted.courier.acceptedAt);assert.equal(courierBalance([resume],courier.id).total,10000);
sent=run(resume,courier,'resume',150);work=run(sent,courier,'toOperator',151,{reason:'Again'});assert.equal(work.reworkDeadline,later(245));assert.equal(work.courier.operatorBudgetMs,94*hour);
// Retired actions cannot be replayed by an older mobile page.
for(const operation of ['toLogistic','requestPostpone','approvePostpone','rejectPostpone'])assert.throws(()=>run(accepted,courier,operation,101,{reason:'Test',at:later(250)}));
const returned=run(accepted,courier,'toOperator',101,{reason:'Недозвон'});
assert.equal(returned.status,'rework');assert.equal(orderGroup(returned).id,'accepted');assert.equal(orderGroup(work).id,'sent');assert.equal(orderGroup({...work,status:'refused'}).id,'cancelled');assert.equal(orderGroup({...work,delivery:'russian_post',courier:undefined}).id,'new');assert.equal(returned.courier.phase,'operator');assert.equal(returned.courier.atDoor,false);
assert.equal(returned.due,'');assert.equal(courierDeadline(returned),undefined);
assert.equal(scheduledCalls([{...returned,contact:'callback',due:later(102)}],operator).length,1);
for(const staff of [logistic,{...logistic,role:'chief_logistic'}]){
 assert.equal(scheduledCalls([{...returned,contact:'callback',due:later(102)}],staff).length,0);
 assert.throws(()=>run(returned,staff,'confirm',102));
}
assert.throws(()=>run(returned,{...operator,id:'other'},'confirm',102));
resume=run(returned,operator,'confirm',102);
assert.equal(resume.courier.confirmedBy,'operator');assert.equal(courierStage(resume),'pending');
assert.equal(run(resume,courier,'resume',103).courier.phase,'delivery');
assert.equal(courierReminderNeedsAction({...notice,at:later(102)},resume),true);
assert.equal(courierReminderNeedsAction(notice,resume),false,'Earlier handoff must not become actionable again');
assert.equal(courierReminderNeedsAction({...notice,kind:'courier-warning',due:courierDeadline(accepted)},accepted),true);
// Recall is physical custody, not a reintroduction of logistic confirmation.
const recalledPending=run(base,logistic,'recall',1,{reason:'Wrong parcel'});
assert.equal(recalledPending.courier,undefined);assert.equal(recalledPending.status,'packing');assert.equal(packingStage(recalledPending),'new');assert.equal(recalledPending.packingWaybillAt,undefined);assert.equal(courierBalance([recalledPending],courier.id).total,0);
assert.throws(()=>run(base,operator,'recall',1,{reason:'Wrong parcel'}));
const requested=run(returned,operator,'requestRepack',102,{reason:'Need two products'});
assert.equal(requested.courier.phase,'operator');assert.equal(requested.reworkDeadline,returned.reworkDeadline);
assert.throws(()=>run(requested,operator,'confirm',103));assert.throws(()=>run(requested,operator,'requestRepack',103,{reason:'Duplicate'}));
const recalled=run(requested,logistic,'recall',103,{reason:requested.courierRepackRequest.reason});
assert.equal(recalled.courier.phase,'recall');assert.equal(courierDeadline(recalled),undefined);assert.equal(recalled.reworkDeadline,undefined);assert.equal(recalled.courier.operatorBudgetMs,94*hour);assert.equal(courierBalance([recalled],courier.id).total,10000);
assert.equal(courierReminderNeedsAction({...notice,at:later(103)},recalled),true);
assert.throws(()=>run(recalled,courier,'confirm',104));assert.throws(()=>run(recalled,logistic,'receiveRecall',104,{confirmed:true}));assert.throws(()=>run(recalled,courier,'returnRecall',104));
const physicallyReturned=run(recalled,courier,'returnRecall',104,{confirmed:true});
assert.equal(packingStage(physicallyReturned),'new');assert.equal(courierBalance([physicallyReturned],courier.id).total,10000);assert.equal(courierReminderNeedsAction({...notice,at:later(104)},physicallyReturned),false);
assert.throws(()=>run(physicallyReturned,courier,'receiveRecall',105,{confirmed:true}));
const received=run(physicallyReturned,logistic,'receiveRecall',105,{confirmed:true});
assert.equal(received.courier,undefined);assert.equal(received.courierRecall.operatorBudgetMs,94*hour);assert.equal(received.packingWaybillAt,undefined);assert.equal(courierBalance([received],courier.id).total,0);assert.equal(received.warehouseReturnedAt,undefined);
assert.throws(()=>run(received,logistic,'receiveRecall',106,{confirmed:true}));
for(const status of ['redeemed','returned','refused'])assert.throws(()=>run({...accepted,status},logistic,'recall',101,{reason:'Invalid final order'}));
// Existing appointments stay valid; the obsolete logistic work queue migrates once.
const logWork={...accepted,courier:{...accepted.courier,phase:'logistic',workReason:'Недозвон'}};
const approved={...sent,status:'shipping',courier:{...sent.courier,phase:'delivery',postponement:{at:later(250),requestedAt:at,reason:'Old appointment',state:'approved'}}};
assert.equal(applyCourierCommand({...base,status:'shipping',courier:{...base.courier,phase:undefined}},{action:'courierAccept',confirmed:true},courier,policy,at).order.status,'shipping');
for(const delivery of ['cdek_pickup','russian_post'])assert.throws(()=>run({...accepted,delivery},courier,'confirm',101));
assert.deepEqual(allowedOrderTransitions({...base,status:'confirm',courier:undefined},'logistic'),['packing','rework']);
assert.deepEqual(allowedOrderTransitions({...base,status:'confirm',delivery:'russian_post',courier:undefined},'logistic'),['extra','rework']);
assert.deepEqual(allowedOrderTransitions({...base,status:'confirm',delivery:'cdek_pickup',courier:undefined},'logistic'),['check','rework']);
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split(';').filter(s=>s.trim()))await d.prepare(sql).run();
 await d.batch(inventorySQL.map(sql=>d.prepare(sql)));await migrateCourierStock(d);await migrateCourierStock(d);
 await d.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').bind('p','product',JSON.stringify({id:'p',name:'Product'})).run();
 await d.prepare("INSERT INTO stock_movements VALUES('initial','p',100,'initial','admin',?)").bind(at).run();
 await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(client.id,client.phone,JSON.stringify(client)).run();
 for(const e of [courier,logistic,operator,{id:'chief',name:'Chief',role:'chief_logistic'}])await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 const records=[
 {...base,id:'pending'},
 {...accepted,id:'courier-expired',courier:{...accepted.courier,workStartedAt:later(-49)}},
 {...logWork,id:'logistic-expired',courier:{...logWork.courier,workStartedAt:later(-49)}},
 {...logWork,id:'logistic-waiting',contact:'callback',due:later(1),courier:{...logWork.courier,workStartedAt:at,workHours:null,operatorBudgetMs:4*hour,postponement:{at:later(250),reason:'Client away',requestedAt:at,state:'pending'}}},
 {...work,id:'operator-expired',reworkDeadline:later(-1),courier:{...work.courier,operatorBudgetMs:hour,operatorStartedAt:later(-2)}},
 {...approved,id:'approved'},
 {...base,id:'first-moscow',courier:undefined,status:'confirm',confirmationStartedAt:later(-49),confirmationHours:48},
 {...base,id:'first-post',courier:undefined,delivery:'russian_post',status:'confirm',confirmationStartedAt:later(-49),confirmationHours:48},
 {...base,id:'first-cdek',courier:undefined,delivery:'cdek_pickup',status:'confirm',confirmationStartedAt:later(-49),confirmationHours:48},
 {...accepted,id:'disabled',courier:{...accepted.courier,workStartedAt:later(-500),workHours:null}}
 ];
 for(const o of records)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,o.clientId,JSON.stringify(o)).run();
 const read=async()=> (await d.prepare('SELECT data,version FROM orders').all()).results.map(r=>({...JSON.parse(r.data),version:r.version}));
 assert.equal(await reconcileOrderTimers(d,await read(),[]),true);
 const current=await read(),get=id=>current.find(o=>o.id===id);
 for(const id of ['courier-expired','logistic-expired','logistic-waiting','first-moscow'])assert.equal(get(id).status,'rework',id);
 for(const id of ['first-post','first-cdek','operator-expired'])assert.equal(get(id).status,'refused',id);
 const migrated=get('logistic-waiting');
 assert.equal(migrated.courier.phase,'operator');assert.equal(migrated.courier.operatorBudgetMs,4*hour);
 assert.equal(migrated.courier.acceptedAt,logWork.courier.acceptedAt);assert.equal(migrated.contact,'none');assert.equal(migrated.due,'');
 assert.equal(migrated.courier.workStartedAt,undefined);assert.equal(migrated.courier.postponement.state,'rejected');
 assert.ok(Math.abs(Date.parse(migrated.reworkDeadline)-Date.now()-4*hour)<10000);
 assert.equal(get('operator-expired').courier.operatorBudgetMs,0);assert.equal(courierStage(get('operator-expired')),'return');
 assert.equal(courierDeadline(get('pending')),undefined);assert.equal(get('pending').status,'packing');assert.equal(get('disabled').status,'packing');assert.equal(get('approved').status,'shipping');
 assert.equal((await d.prepare('SELECT reserved FROM product_stock').first()).reserved,records.length-2);
 assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM reminders WHERE employee_id='operator'").first()).n,4);
 assert.equal(await reconcileOrderTimers(d,await read(),[]),false);
 // Old writes cannot win over a new decision, and accepting the physical return releases exactly once.
 const stale=get('courier-expired');await d.prepare("UPDATE orders SET data=json_set(data,'$.status','shipping'),version=version+1 WHERE id=?").bind(stale.id).run();
 assert.equal(await reconcileOrderTimers(d,[{...stale,reworkDeadline:later(-1)}],[]),false);
 const reserve=(await d.prepare('SELECT reserved FROM product_stock').first()).reserved;
 await d.prepare("UPDATE orders SET data=json_set(data,'$.warehouseReturnedAt',?) WHERE id='operator-expired'").bind(at).run();
 assert.equal((await d.prepare('SELECT reserved FROM product_stock').first()).reserved,reserve-1);
 await d.prepare("UPDATE orders SET data=json_set(data,'$.warehouseReturnedAt',?) WHERE id='operator-expired'").bind(at).run();
 assert.equal((await d.prepare('SELECT reserved FROM product_stock').first()).reserved,reserve-1);
}finally{d.close();}
console.log('Moscow workflow: acceptance clock, stage ownership, operator shared budget, retired actions, legacy queue migration, stock custody, notifications and unchanged CDEK/Post passed.');

// Every Moscow phase exposes work ownership separately from physical custody.
for(const [o,label,place] of [
 [{...base,courier:undefined,status:'draft'},'Оформляет оператор','Ещё не передана курьеру'],
 [{...base,courier:undefined,status:'confirm'},'Первое подтверждение · логист','Ещё не передана курьеру'],
 [base,'Ожидает приёма курьером','Приём курьером не подтверждён'],
 [accepted,'У курьера на подтверждении · 1-й этап','У курьера'],
 [returned,'Заказ в работе у оператора · возврат с подтверждения курьером','У курьера'],
 [work,'Заказ в работе у оператора · возврат с доставки','У курьера'],
 [recalled,'Отозван логистом · вернуть посылку на сборку','У курьера'],
 [physicallyReturned,'Передано логисту · ожидает подтверждения приёма','Передана логисту · приём ещё не подтверждён'],
 [received,'На пересборке у логиста','На складе'],
 [{...received,status:'rework'},'Заказ в работе у оператора · возврат после пересборки','На складе'],
 [{...accepted,status:'refused'},'Отменён · вернуть посылку на склад','У курьера'],
 [{...accepted,status:'returned',warehouseReturnedAt:at},'Посылка принята на склад','На складе'],
 [{...accepted,status:'redeemed'},'Оплачен · деньги у курьера','Доставлена клиенту'],
 [{...accepted,status:'redeemed',paymentReceivedAt:at},'Деньги приняты логистом','Доставлена клиенту'],
]){assert.equal(courierLabel(o),label);assert.equal(courierParcelLocation(o),place);}
assert.deepEqual(allowedOrderTransitions(received,'logistic'),['rework']);
assert.deepEqual(allowedOrderTransitions({...received,status:'rework'},'operator'),['packing','refused']);
assert.deepEqual(allowedOrderTransitions({...received,status:'rework'},'logistic'),[]);
assert.equal(orderGroup({...received,status:'rework'}).id,'accepted');
assert.equal(packingStage({...received,status:'rework'}),'operator');
console.log('Moscow stage labels, return origins, physical locations and warehouse rework transitions passed.');

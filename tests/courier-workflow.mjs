import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {applyCourierCommand,courierToOperator,courierDeadline,courierStage,courierBalance,courierConfirmationStage} from '../lib/courier.ts';
import {allowedOrderTransitions,orderGroup,packingStage,applyRetention,scheduledCalls} from '../lib/crm.ts';
import {defaultOrderPolicy as policy} from '../lib/order-policy.ts';
import {reconcileOrderTimers} from '../lib/base-retention-store.ts';
import {inventorySQL,migrateCourierStock} from '../lib/inventory-sql.ts';
const hour=3600000,at=new Date().toISOString(),time=Date.parse(at),later=n=>new Date(time+n*hour).toISOString();
const courier={id:'driver',name:'Courier',role:'courier'},logistic={id:'logistic',name:'Logistic',role:'logistic'},operator={id:'operator',name:'Operator',role:'operator'};
const client={id:'client',name:'Client',phone:'+79990000111',owner:operator.id,source:'',sheet:'К',address:'Address',createdAt:at,version:1};
const base={id:'o',clientId:client.id,manager:operator.id,logistic:'',delivery:'moscow_courier',status:'packing',packingWaybillAt:at,createdAt:at,updatedAt:at,items:[{name:'Product',quantity:1,price:10000}],address:'Address',comment:'',reason:'',contact:'none',due:'',round:1,extra:false,version:1,courier:{id:courier.id,name:courier.name,assignedAt:at,phase:'pending',amount:10000}};
const run=(o,e,operation,n=0,extra={})=>applyCourierCommand(o,{action:'courierWorkflow',operation,...extra},e,policy,later(n)).order;
assert.equal(courierDeadline(base),undefined);assert.equal(orderGroup(base.status).id,'accepted');assert.equal(packingStage(base),'exported');
assert.deepEqual(courierBalance([base],courier.id),{pending:10000,parcels:0,cash:0,total:0});
assert.throws(()=>run(base,courier,'confirm'));assert.throws(()=>applyCourierCommand(base,{action:'courierAccept',confirmed:true},{...courier,id:'other'},policy,at));
let accepted=applyCourierCommand(base,{action:'courierAccept',confirmed:true},courier,policy,later(100)).order;
assert.equal(courierStage(accepted),'confirmation');assert.equal(accepted.status,'packing');assert.equal(courierDeadline(accepted),later(148));assert.equal(courierBalance([accepted],courier.id).total,10000);
assert.equal(courierConfirmationStage(accepted,time+142*hour),'expiring');
assert.equal(courierConfirmationStage({...accepted,contact:'callback',due:later(101)},time+101*hour),'new');
assert.throws(()=>run(accepted,logistic,'confirm',101));assert.throws(()=>run(accepted,courier,'confirm',149));
let sent=run(accepted,courier,'confirm',101);assert.equal(sent.status,'shipping');assert.equal(courierStage(sent),'delivery');assert.equal(courierDeadline(sent),undefined);
let work=run(sent,courier,'toOperator',102,{reason:'Questions'});assert.equal(work.status,'rework');assert.equal(work.courier.atDoor,true);assert.equal(courierStage(work),'waiting');assert.equal(work.reworkDeadline,later(198));
assert.equal(courierBalance([work],courier.id).parcels,10000);assert.equal(applyRetention(client,[work],time).owner,operator.id);
assert.deepEqual(allowedOrderTransitions(work,'operator'),['refused']);assert.deepEqual(allowedOrderTransitions(work,'logistic'),[]);
assert.throws(()=>run(work,courier,'confirm',103));
let resume=run(work,operator,'confirm',104);assert.equal(resume.courier.operatorBudgetMs,94*hour);assert.equal(resume.courier.operatorStartedAt,undefined);assert.equal(courierStage(resume),'pending');assert.equal(resume.courier.acceptedAt,accepted.courier.acceptedAt);assert.equal(courierBalance([resume],courier.id).total,10000);
sent=run(resume,courier,'resume',150);work=run(sent,courier,'toOperator',151,{reason:'Again'});assert.equal(work.reworkDeadline,later(245));assert.equal(work.courier.operatorBudgetMs,94*hour);
let logWork=run(accepted,courier,'toLogistic',101,{reason:'No answer'});assert.equal(courierDeadline(logWork),later(149));assert.equal(logWork.status,'packing');
assert.equal(scheduledCalls([{...logWork,contact:'callback',due:later(102)}],logistic).length,1);assert.equal(scheduledCalls([{...logWork,contact:'callback',due:later(102)}],courier).length,0);
resume=run(logWork,logistic,'confirm',102);assert.equal(resume.courier.confirmedBy,'logistic');assert.equal(courierStage(resume),'pending');assert.equal(run(resume,courier,'resume',103).courier.phase,'delivery');
let requested=run(accepted,courier,'requestPostpone',101,{reason:'Client away',at:later(250)});assert.equal(courierDeadline(requested),later(149));assert.throws(()=>run(requested,courier,'approvePostpone',102));assert.throws(()=>run(requested,logistic,'confirm',102));
let approved=run(requested,logistic,'approvePostpone',102);assert.equal(approved.status,'shipping');assert.equal(approved.courier.postponement.state,'approved');assert.equal(courierDeadline(approved),undefined);assert.equal(courierStage(approved),'delivery');
const transferred=run(requested,logistic,'toOperator',102,{reason:'Clarify'});assert.equal(run(transferred,operator,'confirm',103).courier.phase,'resume');
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
 for(const id of ['courier-expired','logistic-expired','first-moscow'])assert.equal(get(id).status,'rework',id);
 for(const id of ['first-post','first-cdek','operator-expired'])assert.equal(get(id).status,'refused',id);
 assert.equal(get('operator-expired').courier.operatorBudgetMs,0);assert.equal(courierStage(get('operator-expired')),'return');
 assert.equal(courierDeadline(get('pending')),undefined);assert.equal(get('pending').status,'packing');assert.equal(get('disabled').status,'packing');assert.equal(get('approved').status,'shipping');
 assert.equal((await d.prepare('SELECT reserved FROM product_stock').first()).reserved,records.length-2);
 assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM reminders WHERE employee_id='operator'").first()).n,3);
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
console.log('Moscow workflow: acceptance clock, stage ownership, operator shared budget, postponements, legacy orders, stock custody, notifications and unchanged CDEK/Post passed.');

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {buildFinancialProjection,financialStageStatements,readPreparedFinancialPeriod,readPreparedFinancialStatistics,financialPeriodResponse,attachPreparedPremiumStages} from '../lib/crm-financial-projection.ts';
import {readModelSource,publishPreparedModels} from '../lib/crm-read-model.ts';
const d=openDatabase(':memory:'),wallClock=Date.now;
let now=wallClock();Date.now=()=>now;
const actor={id:'op',login:'op',name:'Synthetic operator',role:'operator',department:'1',salary:0,bonus:10},head={id:'head',login:'head',name:'Synthetic head',role:'department_head',department:'1',salary:0,bonus:0,leaderPremium:{model:'salary_bonus',fixedPerPeriod:0,links:[]}};
const order={id:'o',clientId:'c',manager:'op',status:'redeemed',delivery:'russian_post',paymentReceivedAt:'2026-10-25T10:00:00Z',paymentReceipt:{amount:1000},items:[],legacyLv:{orderId:'external'}};
const ledger={revision:'test',activePeriod:'2026-10-2',initialPeriod:'2026-10-2',periods:{'2026-10-2':{status:'open',signatures:{}}}};
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 for(const e of [actor,head])await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare("INSERT INTO clients(id,phone,data) VALUES('c','test',?)").bind(JSON.stringify({id:'c',owner:'op'})).run();
 await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(order.id,order.clientId,JSON.stringify(order)).run();
 await d.prepare("INSERT INTO settings VALUES('premium-ledger',?)").bind(JSON.stringify(ledger)).run();
 assert.equal((await readPreparedFinancialPeriod(d,actor,ledger.activePeriod)).response,undefined,'cold finance does not calculate in HTTP');
 const publish=async()=>{
  const projection=await buildFinancialProjection(d),statements=await financialStageStatements(d,projection),source=await readModelSource(d);
  await publishPreparedModels(d,[{kind:'finance',scope:'global',data:projection,sourceRevision:source.financeRevision,accessRevision:source.accessRevision,computedAt:now,validUntil:now+30000},{kind:'finance-meta',scope:'global',data:{activePeriod:projection.activePeriod,nextPeriod:projection.stageProjection.nextPeriod},sourceRevision:source.financeRevision,accessRevision:source.accessRevision,computedAt:now,validUntil:now+30000}],statements);
  await d.prepare("UPDATE crm_model_worker SET ok=1,heartbeat=?,message='' WHERE id=1").bind(now).run();return projection;
 };
 const projection=await publish();
 let result=await readPreparedFinancialPeriod(d,actor,ledger.activePeriod);
 assert.equal(result.readModel.status,'ready');assert.deepEqual(JSON.parse(JSON.stringify(result.response)),JSON.parse(JSON.stringify(financialPeriodResponse(projection,actor,ledger.activePeriod))));
 const stats=await readPreparedFinancialStatistics(d,head,'2026-10');assert.equal(stats.readModel.status,'ready');assert.equal(stats.response.rows.find(r=>r.id==='op').total,100);
 const statements=[];
 const track=statement=>({bind:(...args)=>track(statement.bind(...args)),first:(column)=>statement.first(column),all:()=>statement.all(),run:()=>statement.run(),sql:statement.sql,values:statement.values,execute:()=>statement.execute()});
 const measured={prepare:sql=>{statements.push(sql);return track(d.prepare(sql));},batch:rows=>d.batch(rows)};
 const state={clients:[],orders:[order,{...order,id:'duplicate',status:'draft'}],employees:[actor,head],events:[],settings:{retentionDays:30}};
 assert.equal((await attachPreparedPremiumStages(measured,state)).status,'ready');assert.ok(state.orders.every(o=>o.premiumStage.status==='accrued'),'indexed external key applies to another order ID');
 assert.ok(statements.some(sql=>sql.includes('crm_financial_stages WHERE id IN')));
 assert.ok(!statements.some(sql=>/SELECT .* FROM orders(?:\s|$)/.test(sql)),'card decoration never scans raw global orders');
 statements.length=0;await readPreparedFinancialPeriod(measured,actor,ledger.activePeriod);
 assert.ok(!statements.some(sql=>/SELECT .* FROM orders(?:\s|$)/.test(sql)),'prepared financial GET never scans raw orders');

 // A fresh source with an unchanged access scope can retain its last known amount, explicitly stale.
 await d.prepare("UPDATE orders SET data=json_set(data,'$.paymentReceipt.amount',2000),version=version+1 WHERE id='o'").run();
 result=await readPreparedFinancialPeriod(d,actor,ledger.activePeriod);assert.equal(result.readModel.status,'stale');assert.equal(result.response.payroll[0].payout,100);
 now++;await publish();result=await readPreparedFinancialPeriod(d,actor,ledger.activePeriod);assert.equal(result.readModel.status,'ready');assert.equal(result.response.payroll[0].payout,200);
 await d.prepare("UPDATE crm_model_worker SET ok=0,message='Synthetic outage'").run();result=await readPreparedFinancialPeriod(d,actor,ledger.activePeriod);assert.equal(result.readModel.status,'stale');assert.equal(result.response.payroll[0].payout,200,'worker outage never displays zero');
 now+=31000;result=await readPreparedFinancialPeriod(d,actor,ledger.activePeriod);assert.equal(result.readModel.status,'stale','time expiration requires no source write');
 await d.prepare("UPDATE employees SET data=json_set(data,'$.department','2'),version=version+1 WHERE id='op'").run();
 assert.equal((await readPreparedFinancialPeriod(d,head,ledger.activePeriod)).response,undefined,'old department cannot read stale open payroll after transfer');
 now++;await publish();const after=await readPreparedFinancialPeriod(d,head,ledger.activePeriod);assert.ok(after.response.payroll.every(r=>r.employeeId!=='op'),'new projection rechecks payroll visibility');
 // The route may have selected an actor immediately before a concurrent role/department change.
 await d.prepare("UPDATE employees SET data=json_set(data,'$.department','2'),version=version+1 WHERE id='head'").run();now++;await publish();
 assert.equal((await readPreparedFinancialPeriod(d,head,ledger.activePeriod)).response,undefined,'old actor department cannot filter a new authorised projection');
 assert.equal((await readPreparedFinancialStatistics(d,head,'2026-10')).response,undefined,'statistics also rejects a stale actor department');
 const movedHead={...head,department:'2'};assert.ok((await readPreparedFinancialPeriod(d,movedHead,ledger.activePeriod)).response.payroll.some(r=>r.employeeId==='op'));
 await d.prepare("UPDATE employees SET data=json_set(data,'$.role','operator'),version=version+1 WHERE id='head'").run();now++;await publish();
 assert.equal((await readPreparedFinancialPeriod(d,movedHead,ledger.activePeriod)).response,undefined,'old head privileges cannot survive a role downgrade');

 // Simulate a publication between the metadata and indexed-stage reads.
 let crossed=false;
 const crossing={prepare:sql=>{const statement=d.prepare(sql);if(sql.startsWith('SELECT id,data FROM crm_financial_stages WHERE'))return {bind:(...args)=>({all:async()=>{if(!crossed){crossed=true;await d.prepare("UPDATE crm_read_models SET computed_at=computed_at+1 WHERE kind='finance-meta'").run();}return statement.bind(...args).all();}})};return statement;},batch:rows=>d.batch(rows)};
 const before=JSON.stringify(state.orders);assert.equal((await attachPreparedPremiumStages(crossing,state)).status,'pending');assert.equal(JSON.stringify(state.orders),before,'mixed generations cannot modify the card');
 console.log('Ready finance: pending, exact payroll, SQL-projected reads, indexed stages, stale source, worker outage, expiry, transferred access and generation race passed');
}finally{Date.now=wallClock;d.close();}

import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {initPreparedModels,readModelSource,publishPreparedModels,readPreparedModel,requestPreparedWorkspace} from '../lib/crm-read-model.ts';
import {createSummaryWorker,claimSummaryLease,renewSummaryLease,releaseSummaryLease,ContextCache,moscowMonth,moscowDay} from '../lib/crm-summary-worker.ts';
import {workspaceVersions} from '../lib/crm-workspace-clock.ts';
import {readWorkspaceState} from '../lib/crm-workspace-read.ts';
import {buildWorkspaceContext} from '../lib/crm-workspace-context.ts';
import {buildFinancialProjection,applyFinancialProjection} from '../lib/crm-financial-projection.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-summary-test-')),path=join(dir,'synthetic.sqlite'),d=openDatabase(path),reader=openDatabase(path);
const actor={id:'op',login:'op',name:'Synthetic',role:'operator',department:'1',salary:100,bonus:10};
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare('CREATE TABLE auth_accounts(employee_id TEXT PRIMARY KEY,password_hash TEXT,enabled INTEGER)').run();
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(actor.id,JSON.stringify(actor)).run();
 await d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 await d.prepare("INSERT INTO clients(id,phone,data) VALUES('c','test',?)").bind(JSON.stringify({id:'c',owner:'op',name:'Test',phone:'test',source:'Fixture',createdAt:'2026-11-01T00:00:00Z'})).run();
 const order={id:'o',clientId:'c',manager:'op',status:'redeemed',delivery:'russian_post',paymentReceivedAt:'2026-11-01T00:00:00Z',paymentReceipt:{amount:1000},items:[],createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
 await d.prepare("INSERT INTO orders(id,client_id,data) VALUES('o','c',?)").bind(JSON.stringify(order)).run();
 await initPreparedModels(d);
 const worker=await createSummaryWorker(d,reader,'test-worker');await requestPreparedWorkspace(d,'op');
 let result=await worker.tick();assert.equal(result.published,true);assert.equal(result.contextBuilds,1);
 assert.equal((await readPreparedModel(d,'context','op')).status,'ready');assert.equal((await readPreparedModel(d,'summary','op')).status,'ready');
 const count=result.contextBuilds;
 result=await worker.tick(Date.now()+2100);assert.equal(result.contextBuilds,count,'time-only cheap summary reuses enriched context');assert.ok(result.summaryBuilds>1);
 // A receipt import must rebuild only its local contexts; unrelated contexts reuse filtered source data.
 const other={...actor,id:'other',department:'2'},third={...actor,id:'third',department:'3'},head={...actor,id:'head',role:'department_head'};
 for(const employee of [other,third,head]){await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(employee.id,JSON.stringify(employee)).run();await requestPreparedWorkspace(d,employee.id);}
 for(const employee of [other,third]){await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c-'+employee.id,employee.id,JSON.stringify({id:'c-'+employee.id,owner:employee.id,name:'Test',source:'Fixture',phone:'test',createdAt:order.createdAt})).run();await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('o-'+employee.id,'c-'+employee.id,JSON.stringify({...order,id:'o-'+employee.id,clientId:'c-'+employee.id,manager:employee.id,status:employee===other?'draft':'redeemed',legacyLv:{orderId:employee===other?'shared':'unrelated'},paymentReceipt:{amount:777}})).run();}
 await d.prepare("UPDATE orders SET data=json_set(data,'$.legacyLv.orderId','shared') WHERE id='o'").run();
 await d.prepare("INSERT INTO settings VALUES('premium-ledger',?)").bind(JSON.stringify({revision:'fixture',activePeriod:'2026-11-1',initialPeriod:'2026-11-1',periods:{'2026-11-1':{status:'open',signatures:{}}}})).run();
 const config=initialBaseSettings();config.retention.operators.third={mode:'statistics',days:35,defaultWeeks:5,bands:[]};await d.prepare("INSERT INTO settings VALUES('base-settings',?)").bind(JSON.stringify({config})).run();
 const reuseAt=Date.now()+3000;result=await worker.tick(reuseAt);const baseline={...result};
 const unchangedBefore=await d.prepare("SELECT data FROM crm_read_models WHERE kind='context' AND scope='third'").first('data');
 assert.equal((await readPreparedModel(d,'context','other')).data.orders[0].premiumStage.status,'accrued');
 const prepare=reader.prepare,queries=[];reader.prepare=sql=>{queries.push(sql);return prepare(sql);};
 await d.prepare("UPDATE orders SET data=json_set(data,'$.priorPremiumPaid',json('true')) WHERE id='o'").run();result=await worker.tick(reuseAt+1);reader.prepare=prepare;
 assert.equal(result.contextBuilds-baseline.contextBuilds,2,'only local operator and head rebuild after a redeemed receipt change');
 assert.equal(result.financialContextRefreshes-baseline.financialContextRefreshes,2,'foreign scopes refresh only financial stages/retention');
 assert.equal(result.contextWrites-baseline.contextWrites,3,'unaffected foreign context is not rewritten');
 assert.equal(await d.prepare("SELECT data FROM crm_read_models WHERE kind='context' AND scope='third'").first('data'),unchangedBefore,'unchanged large context stays byte-for-byte intact');
 const reused=(await readPreparedModel(d,'context','other',(await workspaceVersions(d,other)).workspace)).data;
 assert.equal(reused.orders[0].premiumStage,undefined,'cross-department external-ID stage removed by targeted refresh');assert.equal(reused.orders[0].paymentReceivedAmount,777,'filtered receipt amount survives targeted reuse');
 const freshContext=await readWorkspaceState(reader,other,false);applyFinancialProjection(await buildFinancialProjection(reader),freshContext);const expected=await buildWorkspaceContext(reader,other,freshContext,reuseAt+1);
 assert.deepEqual(reused.orders,JSON.parse(JSON.stringify(expected.orders)));assert.deepEqual(reused.retentionPreview,expected.retentionPreview);
 assert.ok(queries.some(sql=>sql.includes("AS redeemedAt FROM orders")&&sql.includes("$.manager")),'retention uses fresh owner-wide sales instead of cached visible orders');
 const afterRefresh={...result};result=await worker.tick(reuseAt+2);assert.equal(result.financialContextRefreshes,afterRefresh.financialContextRefreshes,'unchanged finance revision does not repeatedly refresh foreign contexts');
 await d.prepare("UPDATE orders SET data=json_set(data,'$.comment','local edit') WHERE id='o-other'").run();result=await worker.tick(reuseAt+3);assert.equal(result.contextBuilds-afterRefresh.contextBuilds,1,'ordinary local edit still invalidates its full context');
 assert.equal(await claimSummaryLease(d,'competitor'),false,'singleton prevents competing worker');
 await d.prepare('UPDATE crm_model_worker SET lease_until=0').run();assert.equal(await renewSummaryLease(d,'test-worker'),false);assert.equal(await claimSummaryLease(d,'competitor'),true,'expired/crashed lease recoverable');
 const source=await readModelSource(d),now=Date.now();
 const write={kind:'finance-meta',scope:'global',sourceRevision:source.financeRevision,accessRevision:source.accessRevision,data:{activePeriod:'new'},computedAt:now+5000,validUntil:now+30000};
 const stage=()=>d.prepare("INSERT INTO crm_financial_stages(id,data) VALUES('test','\"changed\"') ON CONFLICT(id) DO UPDATE SET data=excluded.data");
 assert.equal(await publishPreparedModels(d,[write],[stage()],'test-worker'),false);assert.equal(await d.prepare("SELECT id FROM crm_financial_stages WHERE id='test'").first(),null,'expired owner cannot change stages');
 // Inject a mutation after optimistic preflight, immediately before the atomic batch.
 let injected=false;
 const crossing={prepare:sql=>d.prepare(sql),batch:async statements=>{if(!injected&&statements.some(s=>s.sql.startsWith('UPDATE crm_model_publish_guard'))){injected=true;await d.prepare("UPDATE orders SET data=json_set(data,'$.paymentReceipt.amount',2000) WHERE id='o'").run();}return d.batch(statements);}};
 await initPreparedModels(crossing);const fresh=await readModelSource(d);
 assert.equal(await publishPreparedModels(crossing,[{...write,sourceRevision:fresh.financeRevision,accessRevision:fresh.accessRevision}],[stage()],'competitor'),false);assert.equal(await d.prepare("SELECT id FROM crm_financial_stages WHERE id='test'").first(),null,'source race rolls back every delta');
 const latest=await readModelSource(d);assert.equal(await publishPreparedModels(d,[{...write,sourceRevision:latest.financeRevision,accessRevision:latest.accessRevision}],[stage()],'competitor'),true);
 await d.prepare("DELETE FROM crm_financial_stages WHERE id='test'").run();assert.equal(await publishPreparedModels(d,[{...write,computedAt:now,sourceRevision:latest.financeRevision,accessRevision:latest.accessRevision}],[stage()],'competitor'),false);assert.equal(await d.prepare("SELECT id FROM crm_financial_stages WHERE id='test'").first(),null,'older model cannot partially replace stages');
 await d.prepare("UPDATE crm_read_models SET data='broken' WHERE kind='finance-meta'").run();assert.equal((await readPreparedModel(d,'finance-meta','global')).status,'error');
 await d.prepare("UPDATE crm_read_models SET data='{}' WHERE kind='finance-meta'").run();assert.equal((await readPreparedModel(d,'finance-meta','global',undefined,Date.now(),'$.missing')).status,'error');
 const before=await readModelSource(d);await d.prepare("UPDATE orders SET data=json_set(data,'$.comment','harmless'),version=version+1 WHERE id='o'").run();assert.equal((await readModelSource(d)).financeRevision,before.financeRevision,'ordinary card notes do not rebuild finance');
 // A coherent older context may publish during ordinary saves; its source token exposes staleness.
 const contextSource=await readModelSource(d),contextWrite={...write,kind:'context',scope:'concurrent',sourceRevision:'old-scope',accessRevision:contextSource.accessRevision};
 let edited=false;
 const editing={prepare:sql=>d.prepare(sql),batch:async statements=>{if(!edited&&statements.some(s=>s.sql.startsWith('UPDATE crm_model_publish_guard'))){edited=true;await d.prepare("UPDATE orders SET data=json_set(data,'$.comment','concurrent save') WHERE id='o'").run();}return d.batch(statements);}};
 assert.equal(await publishPreparedModels(editing,[contextWrite],[],'competitor'),true);assert.equal((await readPreparedModel(d,'context','concurrent','new-scope')).status,'stale');
 // Actors and source revisions must come from the same snapshot when ownership changes concurrently.
 const oldSnapshot=await reader.readSnapshot(async()=>{const source=await readModelSource(reader);await d.prepare("UPDATE employees SET data=json_set(data,'$.department','2') WHERE id='op'").run();const employee=JSON.parse((await reader.prepare("SELECT data FROM employees WHERE id='op'").first()).data);assert.equal(employee.department,'1');return source;});
 assert.equal(await publishPreparedModels(d,[{...contextWrite,accessRevision:oldSnapshot.accessRevision}],[],'competitor'),false,'old department snapshot rejected after access transfer');
 await d.prepare("INSERT INTO auth_accounts VALUES('op','test',1)").run();const access=await readModelSource(d);await d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='op'").run();assert.notEqual((await readModelSource(d)).accessRevision,access.accessRevision);
 const cache=new ContextCache(1000,2);cache.set('a','1',{orders:[]});cache.set('b','1',{orders:[]});cache.get('a','1');cache.set('c','1',{orders:[]});assert.equal(cache.entries.has('b'),false);cache.set('huge','1',{orders:['x'.repeat(2000)]});assert.ok(cache.bytes<=1000);assert.ok(cache.entries.size<=2);
 assert.equal(moscowMonth(Date.parse('2026-11-30T20:59:59Z')),'2026-11');assert.equal(moscowMonth(Date.parse('2026-11-30T21:00:00Z')),'2026-12');
 assert.equal(moscowDay(Date.parse('2026-11-12T20:59:59Z')),'2026-11-12');assert.equal(moscowDay(Date.parse('2026-11-12T21:00:00Z')),'2026-11-13');
 await releaseSummaryLease(d,'competitor');await d.prepare('UPDATE crm_model_demand SET requested_at=0').run();const restarted=await createSummaryWorker(d,reader,'restarted');result=await restarted.tick(now+6000);assert.equal(result.published,true);assert.equal(result.scopes,0);assert.equal((await d.prepare('SELECT count(*) AS n FROM crm_model_demand').first()).n,0);
 console.log('Summary worker: snapshot, prepared models, cache reuse/bounds, singleton/crash recovery, source/lease/generation atomic fences, corruption, access and demand expiry passed');
}finally{reader.close();d.close();rmSync(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {workspaceBootstrap,readWorkspaceState,readWorkspaceCard,hydrateWorkspaceOrders} from '../lib/crm-workspace-read.ts';
import {visibleState} from '../lib/permissions.ts';
import {filteredOrderList,orderListViews,orderSortKeys} from '../lib/crm-order-list.ts';
import {filteredClientList} from '../lib/crm-client-list.ts';
import {clientListSummaries} from '../lib/crm-client-summary.ts';
import {snapshotOrdersQuery,snapshotOrder} from '../lib/snapshot-orders.ts';
import {applyPremiumStages,nextPremiumPreview} from '../lib/premium-ledger.ts';
import {readIncoming,initIncoming} from '../lib/incoming.ts';
const d=openDatabase(':memory:');
const clean=x=>JSON.parse(JSON.stringify(x));
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const staff=[{id:'one',role:'operator',department:'1'},{id:'two',role:'operator',department:'2'},{id:'head',role:'department_head',department:'1'},{id:'empty-head',role:'department_head',department:''}].map(e=>({...e,name:e.id,login:e.id,salary:100,bonus:2,version:1}));
 for(const e of staff)await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 const now='2026-11-12T10:00:00.000Z',statuses=['draft','rework','confirm','extra','check','packing','phone','shipping','pickup','redeemed','returned','refused'];
 const clients=[],orders=[];
 for(let i=0;i<72;i++){
  const owner=i<61?'one':i===71?'':'two',id='c-'+String(i).padStart(3,'0');
  const c={id,name:'Клиент '+i,phone:'+7999'+String(i).padStart(7,'0'),owner,city:'Москва',address:'Адрес',source:'Fixture',createdAt:now,assignedUntil:now,version:1,legacyOrderHistory:[{secret:'history'}],importFields:{phone:'secret'}};clients.push(c);
  const o={id:'o-'+id,clientId:id,manager:owner||'two',logistic:'',status:statuses[i%statuses.length],items:[{name:'Test',quantity:2,price:i}],comment:'Full comment',operatorComments:[{text:'full card only'}],reason:'Reason',contact:i%3?'none':'callback',due:now,round:1,extra:false,delivery:'russian_post',paymentReceivedAt:now,paymentReceipt:{amount:i*2},legacyLv:{orderId:i===62?'duplicate':'external-'+i},createdAt:now,updatedAt:now,version:1};orders.push(o);
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(id,c.phone,JSON.stringify(c)).run();await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,id,JSON.stringify(o)).run();
 }
 // Own order on somebody else's client, and somebody else's order on an owned client.
 for(const [id,clientId,manager] of [['own-cross','c-062','one'],['other-cross','c-000','two']]){const o={...orders[0],id,clientId,manager};orders.push(o);await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(id,clientId,JSON.stringify(o)).run();}
 const ledger={revision:'test',activePeriod:'2026-11-1',periods:{'2026-10-2':{status:'paid',signatures:{},orders:[{id:'foreign-ledger-id',externalId:'external-9',employeeId:'two',department:'2',amount:1}]},'2026-11-1':{status:'open',signatures:{}}}};
 await d.prepare("INSERT INTO settings VALUES('premium-ledger',?)").bind(JSON.stringify(ledger)).run();
 await initIncoming(d);
 await d.prepare("INSERT INTO incoming_calls(id,client_id,at,phone,called_number,shared_queue) VALUES('shared','c-071',?,'test','test',1)").bind(now).run();
 const bootstrap=await workspaceBootstrap(d,staff[0]);assert.equal(bootstrap.clients.length+bootstrap.orders.length+bootstrap.events.length,0);assert.deepEqual(bootstrap.employees,[staff[0]]);
 const fullOrders=(await d.prepare(snapshotOrdersQuery).all()).results.map(snapshotOrder),preview=nextPremiumPreview(ledger,fullOrders,staff);
 const full={...bootstrap,clients,orders:applyPremiumStages(ledger,fullOrders,staff).map(o=>({...o,premiumNextPeriod:preview?.orderIds.has(o.id)?preview.period:undefined})),employees:staff,premiumNextPeriod:preview?.period};
 let comparisons=0;
 for(const e of staff){
  const raw=await readWorkspaceState(d,e),scoped=visibleState(raw,e),legacy=visibleState(full,e);
  assert.deepEqual(scoped.clients.map(c=>c.id),legacy.clients.map(c=>c.id));assert.deepEqual(scoped.orders.map(o=>o.id),legacy.orders.map(o=>o.id));
  assert.ok(scoped.clients.every(c=>c.phone===''&&!c.importFields));
  for(const view of orderListViews)for(const filter of ['all','new','accepted','sent','accrued','paid','refused','expiring','repeat_expiring'])for(const sort of orderSortKeys)for(const direction of ['asc','desc']){
   const q={view,filter,sort,direction,query:'',showNextPremium:false};assert.deepEqual(filteredOrderList(scoped,e,q,Date.parse(now)).map(o=>o.id),filteredOrderList(legacy,e,q,Date.parse(now)).map(o=>o.id));comparisons++;
  }
  for(const filter of ['all','without_orders','in_transit','attention','today','new','callback','rework','free','expires'])for(const clientWorkFilter of ['all','needed','planned','done']){
   const q={filter,clientWorkFilter,query:'',timeZone:'Europe/Moscow'};assert.deepEqual(filteredClientList(scoped,e,q,Date.parse(now)).map(c=>c.id),filteredClientList(legacy,e,q,Date.parse(now)).map(c=>c.id));comparisons++;
  }
  const selected=scoped.orders.slice(0,50),hydrated=await hydrateWorkspaceOrders(d,scoped,selected,e);
  assert.deepEqual(clean(hydrated),clean(legacy.orders.slice(0,50)),'page rows retain all displayed fields and premium membership');
  assert.deepEqual(clientListSummaries(scoped,scoped.clients,Date.parse(now)),clientListSummaries(legacy,legacy.clients,Date.parse(now)));
 }
 assert.equal(await readWorkspaceCard(d,staff[0],'client','c-062'),null,'operator cannot open a foreign client even with an own order');
 assert.equal(await readWorkspaceCard(d,staff[0],'order','o-c-062'),null);
 const card=await readWorkspaceCard(d,staff[0],'order','own-cross');assert.ok(visibleState(card,staff[0]).orders.some(o=>o.id==='own-cross'));assert.ok(!visibleState(card,staff[0]).orders.some(o=>o.id==='o-c-062'));
 assert.equal((await readWorkspaceCard(d,staff[0],'order','o-c-000')).orders[0].comment,'Full comment');
 assert.ok(await readWorkspaceCard(d,staff[2],'client','c-071'),'shared incoming remains accessible to head');
 assert.equal(await readWorkspaceCard(d,staff[0],'client','c-071'),null);
 const incoming=await readIncoming(d,staff[2],staff,[],true),oldIncoming=await readIncoming(d,staff[2],staff,fullOrders);assert.deepEqual(incoming,oldIncoming,'incoming active-order flags do not depend on the loaded list');
 let decodedRows=0;
 const track=statement=>({sql:statement.sql,values:statement.values,execute:()=>statement.execute(),bind:(...args)=>track(statement.bind(...args)),run:()=>statement.run(),first:column=>statement.first(column),all:async()=>{const result=await statement.all();decodedRows+=result.results.filter(r=>typeof r.data==='string').length;return result;}});
 const measured={prepare:sql=>track(d.prepare(sql)),batch:statements=>d.batch(statements)};
 const before=clean(await readWorkspaceState(measured,staff[0])),beforeRows=decodedRows;
 for(let i=0;i<400;i++){const c={...clients[70],id:'foreign-'+i},o={...orders[1],id:'foreign-'+i,clientId:c.id,manager:'two',status:'draft'};await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,'foreign-'+i,JSON.stringify(c)).run();await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,c.id,JSON.stringify(o)).run();}
 decodedRows=0;assert.deepEqual(clean(await readWorkspaceState(measured,staff[0])),before,'foreign growth must not hydrate more workspace rows');assert.equal(decodedRows,beforeRows,'SQL must return the same number of projected data rows after foreign growth');
 console.log(`${comparisons} selector parity comparisons; scoped authorization, shared incoming, full cards, premium membership, summaries and foreign-growth isolation passed`);
}finally{d.close();}

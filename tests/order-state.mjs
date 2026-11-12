import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {readOrderState} from '../lib/order-state.ts';
import {seed} from '../lib/crm.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const state=seed();const now=new Date().toISOString();
 const c={id:'target-client',name:'Test Client',phone:'+79990000001',source:'Test',city:'',address:'',createdAt:now,owner:'anna',assignmentStartedAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),version:1};
 await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,'+79990000001',JSON.stringify(c)).run();
 const o={id:'target',clientId:c.id,manager:'anna',logistic:'',status:'packing',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,version:1};
 await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,c.id,JSON.stringify(o)).run();
 for(const e of state.employees)await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 await d.prepare("INSERT INTO settings VALUES('cdek-shipment-target',?)").bind(JSON.stringify({state:'ready',number:'123',downloadedAt:now})).run();
 const other={...c,id:'other'};await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(other.id,'+79990000002',JSON.stringify(other)).run();
 for(let i=0;i<50;i++)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('other-'+i,other.id,JSON.stringify({...o,id:'other-'+i,clientId:other.id,status:'draft',createdAt:'2020-01-01T00:00:00Z',draftHours:1})).run();
 const scoped=await readOrderState(d,'target');
 assert.deepEqual(scoped.orders.map(o=>o.id),['target']);assert.deepEqual(scoped.clients.map(c=>c.id),['target-client']);
 assert.equal(scoped.orders[0].cdekTrackingNumber,'123');assert.equal(scoped.orders[0].cdekExported,true);assert.equal(scoped.orders[0].cdekWaybillReceived,true);
 assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM orders WHERE json_extract(data,'$.status')='draft'").first()).n,50,'saving one order must not reconcile unrelated expired orders');
 await assert.rejects(readOrderState(d,'absent'),/Заказ не найден/);
 console.log('Bounded order state: client scope, shipment metadata and no unrelated timer changes passed');
}finally{d.close();}

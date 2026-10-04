import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {reconcileOrderTimers} from '../lib/base-retention-store.ts';
import {confirmationDeadline,confirmationStage,applyRetention} from '../lib/crm.ts';
import {defaultOrderPolicy} from '../lib/order-policy.ts';
import {inventorySQL} from '../lib/inventory-sql.ts';
const db=openDatabase(':memory:'),now=Date.now(),old=new Date(now-49*3600000).toISOString(),fresh=new Date(now).toISOString();
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
 await db.batch(inventorySQL.map(sql=>db.prepare(sql)));
 const client={id:'client',phone:'+79990008006',owner:'operator',sheet:'К',returnSheet:'Т2',assignedUntil:'',createdAt:old};
 await db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(client.id,client.phone,JSON.stringify(client)).run();
 await db.prepare('INSERT INTO products(id,name_key,data) VALUES(?,?,?)').bind('product','test',JSON.stringify({name:'Test'})).run();
 await db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').bind('stock','product',100,'Test','operator',old).run();
 const base={id:'first',clientId:client.id,manager:'operator',status:'confirm',items:[{name:'Test',quantity:1,price:100}],createdAt:old,updatedAt:fresh,contact:'callback',due:fresh,confirmationStartedAt:old,confirmationHours:48,round:1,extra:false,version:1};
 const orders=[base,{...base,id:'repeat',status:'extra'},{...base,id:'waiting',confirmationStartedAt:fresh},{...base,id:'disabled',confirmationHours:null},{...base,id:'check',status:'check'},{...base,id:'rework',status:'rework',reworkHours:96,reworkDeadline:new Date(now+96*3600000).toISOString()},{...base,id:'final',finalHandoffAt:new Date(now-25*3600000).toISOString(),finalConfirmHours:24},{...base,id:'final-disabled',finalHandoffAt:old,finalConfirmHours:null}];
 for(const o of orders)await db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,o.clientId,JSON.stringify(o)).run();
 const read=async()=> (await db.prepare('SELECT data,version FROM orders').all()).results.map(r=>({...JSON.parse(r.data),version:r.version}));
 assert.equal(confirmationDeadline(base),new Date(now-3600000).toISOString());
 for(const contact of ['none','missed','callback'])assert.equal(confirmationDeadline({...base,contact,updatedAt:fresh}),confirmationDeadline(base));
 for(const id of ['disabled','check','rework','final-disabled'])assert.equal(confirmationDeadline(orders.find(o=>o.id===id)),undefined);
 assert.equal(confirmationStage({...base,confirmationStartedAt:new Date(now-42*3600000).toISOString()},now),'expiring');
 assert.equal(confirmationStage({...base,status:'extra',confirmationStartedAt:new Date(now-42*3600000).toISOString()},now),'repeat_expiring');
 assert.equal(await reconcileOrderTimers(db,orders,[]),true);
 const after=await read();
 for(const o of after){assert.equal(o.status,['first','repeat','final'].includes(o.id)?'refused':orders.find(x=>x.id===o.id).status);}
 assert.equal((await db.prepare('SELECT reserved FROM product_stock').first()).reserved,5);
 assert.equal(await reconcileOrderTimers(db,await read(),[]),false);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,3);
 assert.equal(applyRetention(client,after.filter(o=>o.status==='refused'),now).owner,'');
 assert.equal(applyRetention(client,after,now).owner,'operator');
 assert.equal(applyRetention(client,[after[0],{...base,status:'redeemed',redeemedAt:fresh}],now).owner,'operator');
 // A stale background snapshot must not cancel a concurrently advanced order.
 const waiting=after.find(o=>o.id==='waiting');
 await db.prepare("UPDATE orders SET data=json_set(data,'$.status','packing'),version=version+1 WHERE id=?").bind(waiting.id).run();
 assert.equal(await reconcileOrderTimers(db,[{...waiting,confirmationStartedAt:old}],[]),false);
 // Legacy orders start once at migration with the current per-stage setting.
 await db.prepare("INSERT INTO settings(id,data) VALUES('order-policy',?)").bind(JSON.stringify({policy:{...defaultOrderPolicy,confirmationHours:5,extraConfirmationHours:null}})).run();
 for(const status of ['confirm','extra']){const o={...base,id:'legacy-'+status,status};delete o.confirmationStartedAt;delete o.confirmationHours;await db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,o.clientId,JSON.stringify(o)).run();}
 assert.equal(await reconcileOrderTimers(db,await read(),[]),true);
 const migrated=await read(),legacy=migrated.find(o=>o.id==='legacy-confirm');
 assert.ok(Date.parse(legacy.confirmationStartedAt)>=now);assert.equal(legacy.confirmationHours,5);assert.equal(legacy.status,'confirm');
 assert.equal(migrated.find(o=>o.id==='legacy-extra').confirmationHours,null);
 assert.equal(await reconcileOrderTimers(db,migrated,[]),false);
 console.log('Confirmation timers: stage expiry, call/edit stability, final priority, disabled stages, warnings, stock/retention, concurrency and one-time legacy initialization passed.');
}finally{db.close();}

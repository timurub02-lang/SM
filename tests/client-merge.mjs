import assert from 'node:assert/strict';
import {initBaseStorage} from '../lib/base-storage.ts';
import {openDatabase} from '../server/sqlite.ts';
import {mergeClients,mergePreview} from '../lib/client-merge.ts';
import {mayCallEndpoint,authorizeCrm} from '../lib/permissions.ts';
import {closedOrderCallBlocked} from '../lib/crm.ts';
import {showOrderInList} from '../lib/order-premium-stage.ts';
const d=openDatabase(':memory:');
for(const sql of [
 'CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT,data TEXT,version INTEGER)',
 'CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)',
 'CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id),data TEXT,version INTEGER)',
 'CREATE TABLE events(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id),order_id TEXT,at TEXT,data TEXT)',
 'CREATE TABLE client_phone_index(phone TEXT,client_id TEXT REFERENCES clients(id) ON DELETE CASCADE)',
 'CREATE TABLE phone_calls(id TEXT PRIMARY KEY,client_id TEXT REFERENCES clients(id),ended_at TEXT)',
 'CREATE TABLE base_import_snapshots(session TEXT,client_id TEXT,data TEXT)',
 'CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)',
 'CREATE TABLE cash_operations(id TEXT PRIMARY KEY,amount INTEGER)',
])await d.prepare(sql).run();
for(const id of ['a','b'])await d.prepare('INSERT INTO employees VALUES(?,?)').bind(id,JSON.stringify({id,role:'operator',name:id,login:id})).run();
for(const [id,owner,phone] of [['one','a','+79000000001'],['two','b','+79000000002'],['three','','+79000000003']]){
 const client={id,name:'Иванов Иван',phone,owner,baseType:'M',sheet:owner?'К':'Т1',version:1,assignedUntil:'2026-12-01',assignmentStartedAt:'2026-11-01',legacyOrderHistory:[{externalId:id}]};
 await d.prepare('INSERT INTO clients VALUES(?,?,?,1)').bind(id,phone,JSON.stringify(client)).run();
 await d.prepare('INSERT INTO client_phone_index VALUES(?,?)').bind(phone.slice(1),id).run();
}
const order={id:'order',clientId:'two',manager:'b',status:'redeemed',items:[{name:'товар',quantity:1,price:10000}],version:1};
await d.prepare('INSERT INTO orders VALUES(?,?,?,1)').bind(order.id,order.clientId,JSON.stringify(order)).run();
await d.prepare("INSERT INTO phone_calls VALUES('call','two','2026-11-01')").run();
await d.prepare("INSERT INTO base_import_snapshots VALUES('import','two','{}')").run();
await d.prepare("INSERT INTO settings VALUES('premium-ledger','{\"unchanged\":true}')").run();
await initBaseStorage(d);
const ids=['one','two','three'];let p=await mergePreview(d,ids);
assert.equal(p.clients.length,3);assert.equal((await d.prepare('SELECT count(*) AS n FROM clients').first()).n,3); // preview is read-only
await assert.rejects(mergeClients(d,{ids,ownerClientId:'one',phone:'+79000000001',revision:'old'},'admin'));
await d.prepare("UPDATE phone_calls SET ended_at=NULL").run();
await assert.rejects(mergeClients(d,{ids,ownerClientId:'one',phone:'+79000000001',revision:p.revision},'admin'));
assert.equal((await d.prepare('SELECT count(*) AS n FROM clients').first()).n,3);
assert.equal((await d.prepare('SELECT count(*) AS n FROM client_merge_audit').first()).n,0);
await d.prepare("UPDATE phone_calls SET ended_at='2026-11-01'").run();
const result=await mergeClients(d,{ids,ownerClientId:'one',phone:'+79000000003',revision:p.revision},'admin');
assert.deepEqual((await d.prepare('SELECT phone FROM client_phone_index ORDER BY phone').all()).results.map(r=>r.phone),['79000000001','79000000002','79000000003']);
assert.equal(result.client.owner,'a');assert.equal(result.client.assignedUntil,'2026-12-01');assert.equal(result.client.assignmentStartedAt,'2026-11-01');assert.equal(result.client.phone,'+79000000003');assert.equal(result.client.linkedPhones.length,2);assert.equal(result.client.legacyOrderHistory.length,3);
assert.equal((await d.prepare('SELECT count(*) AS n FROM clients').first()).n,1);
const saved=JSON.parse((await d.prepare('SELECT data FROM orders').first()).data);
assert.equal(saved.manager,'b');assert.equal(saved.clientId,'one');assert.deepEqual(saved.items,order.items);
assert.equal((await d.prepare('SELECT client_id FROM phone_calls').first()).client_id,'one');
assert.equal((await d.prepare('SELECT client_id FROM base_import_snapshots').first()).client_id,'two');
assert.equal((await d.prepare('SELECT data FROM settings').first()).data,'{"unchanged":true}');
const audit=JSON.parse((await d.prepare('SELECT data FROM client_merge_audit').first()).data);assert.equal(audit.clients.length,3);assert.equal(audit.references.phone_calls[0].client_id,'two');
assert.equal(closedOrderCallBlocked({id:'b',role:'operator'},saved,result.client),true);
assert.equal(showOrderInList(saved,result.client,'operator'),true);
assert.equal(showOrderInList({...saved,premiumStage:{status:'paid',periodId:'p',paidAt:'2026-11-01'}},result.client,'operator',Date.parse('2026-11-05')),false);
for(const role of ['operator','department_head','chief_logistic'])assert.equal(mayCallEndpoint({role},new URL('http://localhost/api/client-merge'),'POST'),false);
assert.equal(mayCallEndpoint({role:'admin'},new URL('http://localhost/api/client-merge'),'POST'),true);
await assert.rejects(mergeClients(d,{ids,ownerClientId:'one',phone:'+79000000003',revision:p.revision},'admin')); // no duplicate mutation on retry
console.log('client merge: preview, atomic rollback, ownership, history, financial preservation and permissions passed');
d.close();

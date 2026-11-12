import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initCrmChangeClock,crmChangeRevision} from '../lib/crm-change-clock.ts';
const d=openDatabase(':memory:');
try{
 await d.prepare('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT,version INTEGER)').run();
 await initCrmChangeClock(d);const initial=await crmChangeRevision(d);
 await d.prepare("INSERT INTO orders VALUES('one','{}',1)").run();const inserted=await crmChangeRevision(d);assert.notEqual(inserted,initial);
 await d.prepare("UPDATE orders SET data=data").run();assert.equal(await crmChangeRevision(d),inserted,'no-op writes must not cause a refresh loop');
 await assert.rejects(d.batch([d.prepare("UPDATE orders SET version=2"),d.prepare("INSERT INTO orders VALUES('one','{}',1)")]));assert.equal(await crmChangeRevision(d),inserted,'rollback must roll back its notification');
 await d.prepare("UPDATE orders SET version=2").run();const updated=await crmChangeRevision(d);assert.notEqual(updated,inserted);
 await d.prepare("DELETE FROM orders").run();assert.notEqual(await crmChangeRevision(d),updated);
 await d.prepare('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)').run();await initCrmChangeClock(d);const healthRevision=await crmChangeRevision(d);await d.prepare("INSERT INTO settings VALUES('crm-maintenance-health','{}')").run();assert.equal(await crmChangeRevision(d),healthRevision,'worker heartbeats must not refresh every browser');
 const before=await crmChangeRevision(d);await initCrmChangeClock(d);assert.equal(await crmChangeRevision(d),before,'reconnect preserves the clock');
 console.log('CRM clock: insert, update, delete, rollback and idempotent initialization passed');
}finally{d.close();}

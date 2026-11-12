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
 for(const id of ['cdek-shipment-test','cdek-sync-health','sk-order-health','lv-incoming-health']){
  const first={checkedAt:'before',state:'ready',number:'test',changed:0};
  await d.prepare('INSERT INTO settings VALUES(?,?)').bind(id,JSON.stringify(first)).run();const created=await crmChangeRevision(d);
  await d.prepare('UPDATE settings SET data=? WHERE id=?').bind(JSON.stringify({...first,checkedAt:'after'}),id).run();assert.equal(await crmChangeRevision(d),created,id+': polling timestamp must not invalidate');
  if(!id.startsWith('cdek-shipment-')){
   await d.prepare('UPDATE settings SET data=? WHERE id=?').bind(JSON.stringify({...first,at:'now',lastSuccessAt:'now'}),id).run();assert.equal(await crmChangeRevision(d),created,id+': health timestamps must not invalidate');
  }
  for(const change of [{state:'deleting'},{number:'other'},{downloadedAt:'now'},{syncError:'retry'},{review:[{reason:'changed'}]},{unknownFutureField:true},...(id.startsWith('cdek-shipment-')?[{at:'business-field'}]:[])]){
   await d.prepare('UPDATE settings SET data=? WHERE id=?').bind(JSON.stringify(first),id).run();
   const previous=await crmChangeRevision(d);await d.prepare('UPDATE settings SET data=? WHERE id=?').bind(JSON.stringify({...first,...change}),id).run();
   assert.notEqual(await crmChangeRevision(d),previous,id+': real/unknown field changes must invalidate');
  }
  const previous=await crmChangeRevision(d);await d.prepare('DELETE FROM settings WHERE id=?').bind(id).run();assert.notEqual(await crmChangeRevision(d),previous,'deletion is visible');
 }
 await d.prepare("INSERT INTO settings VALUES('base-settings','{}')").run();const config=await crmChangeRevision(d);
 await d.prepare("UPDATE settings SET data=? WHERE id='base-settings'").bind('{"checkedAt":"business-config"}').run();assert.notEqual(await crmChangeRevision(d),config,'do not suppress other settings');
 await d.prepare("INSERT INTO settings VALUES('cdek-shipment-malformed','not-json')").run();const malformed=await crmChangeRevision(d);
 await d.prepare("UPDATE settings SET data='still-not-json' WHERE id='cdek-shipment-malformed'").run();assert.notEqual(await crmChangeRevision(d),malformed,'invalid legacy JSON is not ignored or rejected by the trigger');
 // Upgrade an already installed legacy trigger atomically, retaining its name for rollback runtimes.
 await d.batch([d.prepare('DROP TRIGGER crm_clock_settings_UPDATE'),d.prepare("CREATE TRIGGER crm_clock_settings_UPDATE AFTER UPDATE ON settings WHEN OLD.data IS NOT NEW.data AND NEW.id<>'crm-maintenance-health' BEGIN UPDATE crm_change_clock SET revision=revision+1 WHERE id=1; END")]);
 const legacy=await crmChangeRevision(d);await initCrmChangeClock(d);assert.notEqual(await crmChangeRevision(d),legacy,'migration invalidates old cached state once');
 const definition=await d.prepare("SELECT sql FROM sqlite_master WHERE name='crm_clock_settings_UPDATE'").first('sql');assert(definition.includes('json_remove'));
 const schema=await d.prepare('PRAGMA schema_version').first('schema_version'),migrated=await crmChangeRevision(d);
 await initCrmChangeClock(d);assert.equal(await crmChangeRevision(d),migrated);assert.equal(await d.prepare('PRAGMA schema_version').first('schema_version'),schema,'no repeated DDL');
 await d.prepare("CREATE TRIGGER IF NOT EXISTS crm_clock_settings_UPDATE AFTER UPDATE ON settings BEGIN UPDATE crm_change_clock SET revision=revision+1 WHERE id=1; END").run();
 assert.equal(await d.prepare("SELECT sql FROM sqlite_master WHERE name='crm_clock_settings_UPDATE'").first('sql'),definition,'old runtime initialization cannot restore noisy triggers');
 console.log('CRM clock: insert, update, delete, rollback and idempotent initialization passed');
}finally{d.close();}

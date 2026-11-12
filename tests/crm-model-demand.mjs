import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {requestPreparedWorkspace,readModelSource,publishPreparedModels,readPreparedModel} from '../lib/crm-read-model.ts';

const dir=mkdtempSync(join(tmpdir(),'crm-model-demand-')),file=join(dir,'test.sqlite'),db=openDatabase(file),writer=new DatabaseSync(file);
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await db.prepare(sql).run();
 const at=Date.now();await requestPreparedWorkspace(db,'one',at);
 // Settle lazy schema discovery before another process holds the normal data writer lock.
 await requestPreparedWorkspace(db,'one',at+1);
 writer.exec('BEGIN IMMEDIATE');
 try{await requestPreparedWorkspace(db,'one',at+30000);}finally{writer.exec('ROLLBACK');}
 assert.equal(await db.prepare("SELECT requested_at FROM crm_model_demand WHERE employee_id='one'").first('requested_at'),at);
 await requestPreparedWorkspace(db,'one',at+30001);
 assert.equal(await db.prepare("SELECT requested_at FROM crm_model_demand WHERE employee_id='one'").first('requested_at'),at+30001);
 await db.prepare("DELETE FROM crm_model_demand WHERE employee_id='one'").run();
 await requestPreparedWorkspace(db,'one',at+30002);
 assert.equal(await db.prepare("SELECT requested_at FROM crm_model_demand WHERE employee_id='one'").first('requested_at'),at+30002,'deleted demand must be registered again');
 await db.prepare('UPDATE crm_model_worker SET ok=1,heartbeat=?').bind(at).run();
 assert.equal((await readPreparedModel(db,'test','missing',undefined,at)).status,'pending');
 const source=await readModelSource(db);await publishPreparedModels(db,[{kind:'test',scope:'one',data:{value:42},sourceRevision:'v1',accessRevision:source.accessRevision,computedAt:at,validUntil:at+1000}]);
 let selects=0;const counted={prepare(sql){if(/^SELECT/i.test(sql))selects++;return db.prepare(sql);},batch:statements=>db.batch(statements)};
 await readPreparedModel(counted,'test','one','v1',at);await readPreparedModel(counted,'test','one','v1',at);selects=0;
 assert.equal((await readPreparedModel(counted,'test','one','v1',at)).status,'ready');assert.equal(selects,1,'access, health and model are read in one snapshot');
 assert.equal((await readPreparedModel(db,'test','one','v2',at)).status,'stale');assert.equal((await readPreparedModel(db,'test','one','v1',at+1000)).status,'stale');
 assert.equal((await readPreparedModel(db,'test','one','v1',at,'$.missing')).status,'error');
 await db.prepare("UPDATE crm_read_models SET access_revision='other' WHERE kind='test'").run();const fenced=await readPreparedModel(db,'test','one','v1',at);assert.equal(fenced.status,'pending');assert.equal(fenced.data,undefined);
 await db.prepare('DELETE FROM crm_model_worker').run();assert.equal((await readPreparedModel(db,'test','missing',undefined,at)).status,'error');
 await db.prepare("UPDATE crm_read_models SET access_revision=? WHERE kind='test'").bind(source.accessRevision).run();assert.equal((await readPreparedModel(db,'test','one','v1',at)).status,'stale');
 console.log('Prepared demand: active reads bypass writer lock; expired/deleted demand renews.');
}finally{writer.close();db.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-model-demand-'));rmSync(dir,{recursive:true,force:true});}

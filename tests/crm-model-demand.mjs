import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {requestPreparedWorkspace} from '../lib/crm-read-model.ts';

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
 console.log('Prepared demand: active reads bypass writer lock; expired/deleted demand renews.');
}finally{writer.close();db.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-model-demand-'));rmSync(dir,{recursive:true,force:true});}

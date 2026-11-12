import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {createSummaryWorker} from '../lib/crm-summary-worker.ts';
import {requestPreparedWorkspace,readPreparedModel,readModelSource} from '../lib/crm-read-model.ts';
const directory=mkdtempSync(join(tmpdir(),'crm-publish-')),path=join(directory,'synthetic.sqlite');
const d=openDatabase(path),reader=openDatabase(path),wallClock=Date.now;let now=wallClock();Date.now=()=>now;
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare('CREATE TABLE auth_accounts(employee_id TEXT PRIMARY KEY,password_hash TEXT,enabled INTEGER)').run();
 const employees=['a','b'].map(id=>({id,name:id,login:id,role:'operator',department:id,salary:0,bonus:0}));
 for(const employee of employees){await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(employee.id,JSON.stringify(employee)).run();await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(employee.id,employee.id,JSON.stringify({id:employee.id,owner:employee.id,name:employee.id,source:'Fixture',createdAt:new Date(now).toISOString()})).run();}
 const worker=await createSummaryWorker(d,reader,'publication');for(const employee of employees)await requestPreparedWorkspace(d,employee.id);
 await d.prepare('INSERT INTO client_reminders(id,employee_id,client_id,due,text,created_at) VALUES(?,?,?,?,?,?)').bind('due','b','b',new Date(now+2000).toISOString(),'Synthetic',new Date(now).toISOString()).run();
 const snapshot=reader.readSnapshot;let snapshots=0;
 reader.readSnapshot=async read=>{
  snapshots++;
  if(snapshots===3){
   assert.equal((await readPreparedModel(d,'finance-meta','global')).status,'ready','finance publishes before scoped enrichment');
   assert.equal((await readPreparedModel(d,'summary','a')).status,'ready','first scope publishes before second scope starts');
   assert.equal((await readPreparedModel(d,'summary','b')).data,undefined);
   now+=4000; // Simulated later-scope work crosses the original three-second TTL and reminder deadline.
  }
  return snapshot(read);
 };
 assert.equal((await worker.tick()).published,true);
 const second=await readPreparedModel(d,'summary','b');assert.equal(second.status,'ready');assert.equal(Date.parse(second.computedAt),now);assert.equal(second.data.work.needed,1,'time-dependent counters use the actual per-scope clock');
 assert.equal(await d.prepare("SELECT valid_until-computed_at AS ttl FROM crm_read_models WHERE kind='summary' AND scope='b'").first('ttl'),3000,'freshness was not obtained by extending TTL');
 assert.equal((await readPreparedModel(d,'summary','a')).status,'stale','earlier data is honestly expired after the delayed scope');
 reader.readSnapshot=snapshot;now+=1;await worker.tick();assert.equal((await readPreparedModel(d,'summary','a')).status,'ready');
 // A financial mutation immediately before scoped publication must roll back that scope,
 // while preserving the previously published financial generation and context.
 const before=await d.prepare("SELECT data,computed_at FROM crm_read_models WHERE kind='summary' AND scope='a'").first();
 const financeBefore=await d.prepare("SELECT source_revision FROM crm_read_models WHERE kind='finance'").first('source_revision');
 const batch=d.batch;let injected=false;
 d.batch=async statements=>{if(!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO crm_read_models')&&s.values[0]==='summary')){injected=true;await d.prepare("INSERT INTO settings VALUES('premium-draft:2026-11-1:a','{}')").run();}return batch(statements);};
 now+=2100;assert.equal((await worker.tick()).published,false);assert.equal(injected,true);
 assert.deepEqual(await d.prepare("SELECT data,computed_at FROM crm_read_models WHERE kind='summary' AND scope='a'").first(),before,'financial fence rolls back scoped publication');
 assert.equal(await d.prepare("SELECT source_revision FROM crm_read_models WHERE kind='finance'").first('source_revision'),financeBefore);
 assert.notEqual((await readModelSource(d)).financeRevision,financeBefore);
 console.log('Scoped publication: independent finance and scopes, real-time deadline calculation, unchanged TTL, honest stale status and financial-generation rollback passed');
}finally{Date.now=wallClock;reader.close();d.close();if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw Error('Unexpected test directory');rmSync(directory,{recursive:true,force:true});}

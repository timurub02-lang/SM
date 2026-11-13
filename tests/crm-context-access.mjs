import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {initIncoming} from '../lib/incoming.ts';
import {initPreparedModels,readModelSource,publishPreparedModels,readPreparedModel} from '../lib/crm-read-model.ts';
import {workspaceVersions} from '../lib/crm-workspace-clock.ts';

const d=openDatabase(':memory:');
const staff=[{id:'a',role:'operator',department:'1'},{id:'b',role:'operator',department:'2'},{id:'h1',role:'department_head',department:'1'},{id:'h2',role:'department_head',department:'2'}];
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 for(const e of staff)await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 await d.prepare('CREATE TABLE auth_accounts(employee_id TEXT PRIMARY KEY,password_hash TEXT,enabled INTEGER)').run();
 await initIncoming(d);await initPreparedModels(d);
 for(const e of staff.slice(0,2))await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind('c'+e.id,e.id,JSON.stringify({id:'c'+e.id,owner:e.id})).run();
 await d.prepare("INSERT INTO orders(id,client_id,data) VALUES('oa','ca','{\"id\":\"oa\",\"manager\":\"a\",\"status\":\"draft\"}')").run();
 const publish=async()=>{
  const source=await readModelSource(d),now=Date.now();
  const rows=[];
  for(const e of staff)for(const kind of ['context','summary'])rows.push({kind,scope:e.id,data:{privateFor:e.id},sourceRevision:(await workspaceVersions(d,e)).workspace,accessRevision:source.accessRevision,computedAt:now,validUntil:now+30000});
  rows.push({...rows[0],kind:'finance-meta',scope:'global',sourceRevision:source.financeRevision});
  assert.equal(await publishPreparedModels(d,rows),true);
  await d.prepare('UPDATE crm_model_worker SET ok=1,heartbeat=?').bind(now).run();
 };
 const visible=async ids=>{for(const e of staff)for(const kind of ['context','summary'])assert.equal(!!(await readPreparedModel(d,kind,e.id)).data,ids.includes(e.id),`${kind} ${e.id}`);};
 await publish();
 const before=await readModelSource(d),oldVersion=(await workspaceVersions(d,staff[0])).workspace;
 await d.prepare("INSERT INTO clients(id,phone,data) VALUES('new','new','{\"id\":\"new\",\"owner\":\"b\"}')").run();
 assert.notEqual((await readModelSource(d)).accessRevision,before.accessRevision);
 await visible(['a','h1']);
 assert.equal((await readPreparedModel(d,'context','a',oldVersion)).status,'ready','foreign insert cannot unload an unchanged workspace');
 assert.equal((await readPreparedModel(d,'finance-meta','global')).data,undefined,'global financial model keeps its strict access fence');
 await publish();
 await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','a') WHERE id='new'").run();
 await visible([]);
 assert.equal((await readPreparedModel(d,'context','b','caller-read-before-transfer')).data,undefined,'a stale caller revision is not evidence of current rights');
 await publish();
 await d.prepare("UPDATE orders SET data=json_set(data,'$.manager','b') WHERE id='oa'").run();await visible([]);
 await publish();
 await d.prepare("INSERT INTO incoming_calls(id,client_id,assignee_id,department_id,at,phone,called_number,shared_queue) VALUES('i','cb','b','2','','','',1)").run();await visible(['a']);
 await publish();
 await d.prepare("DELETE FROM incoming_calls WHERE id='i'").run();await visible(['a']);
 await publish();
 await d.prepare("UPDATE employees SET data=json_set(data,'$.department','2') WHERE id='a'").run();await visible([]);
 await publish();
 await d.prepare("INSERT INTO auth_accounts VALUES('a','synthetic',1)").run();await visible([]);
 await publish();
 await d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='a'").run();await visible([]);
 await publish();
 await d.prepare("UPDATE crm_change_clock SET epoch='restored'").run();await visible([]);
 await publish();
 await d.prepare("UPDATE crm_read_models SET scope_revision='' WHERE scope='a'").run();
 await d.prepare("INSERT INTO clients(id,phone,data) VALUES('foreign','foreign','{\"owner\":\"b\"}')").run();
 assert.equal((await readPreparedModel(d,'context','a')).data,undefined,'legacy rows without a scope proof fail closed');
 await publish();
 const source=await readModelSource(d),stored=await d.prepare("SELECT scope_revision FROM crm_read_models WHERE kind='context' AND scope='b'").first('scope_revision');
 let injected=false;
 const crossing={prepare:sql=>d.prepare(sql),batch:async statements=>{
  if(!injected&&statements.some(s=>s.sql.startsWith('UPDATE crm_model_publish_guard'))){injected=true;await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','a') WHERE id='cb'").run();}
  return d.batch(statements);
 }};
 assert.equal(await publishPreparedModels(crossing,[{kind:'context',scope:'b',data:{revoked:true},sourceRevision:'old',accessRevision:source.accessRevision,computedAt:Date.now(),validUntil:Date.now()+30000}]),false,'access race still aborts publication and its scope proof');
 assert.equal(await d.prepare("SELECT scope_revision FROM crm_read_models WHERE kind='context' AND scope='b'").first('scope_revision'),stored);
 assert.equal((await readPreparedModel(d,'context','b')).data,undefined);
 console.log('Context access: foreign writes preserve context; ownership, managers, shared incoming, staff, accounts and restored clocks stay fenced');
}finally{d.close();}

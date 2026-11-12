import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {workspaceSummarySignal} from '../lib/crm-summary-signal.ts';
import {readModelSource,publishPreparedModels} from '../lib/crm-read-model.ts';
const d=openDatabase(':memory:');let now=Date.now();
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare("INSERT INTO employees(id,data) VALUES('private-actor','{\"id\":\"private-actor\",\"role\":\"operator\"}')").run();
 let source=await readModelSource(d);
 const healthy=()=>d.prepare('UPDATE crm_model_worker SET ok=1,heartbeat=?').bind(now).run();
 const signal=()=>workspaceSummarySignal(d,'private-actor','scope-v1',now);
 const publish=async data=>{await publishPreparedModels(d,[{kind:'summary',scope:'private-actor',data,sourceRevision:'scope-v1',accessRevision:source.accessRevision,computedAt:now,validUntil:now+3000}]);await healthy();};
 const failed=await signal();await healthy();const pending=await signal();assert.notEqual(pending,failed);
 await publish({nav:{incoming:1},listRevision:'membership-one'});const ready=await signal();assert.notEqual(ready,pending);assert.match(ready,/^[A-Za-z0-9_-]{43}$/);assert.ok(!ready.includes('private-actor'));
 now++;await publish({nav:{incoming:1},listRevision:'membership-one'});assert.equal(await signal(),ready,'unchanged computation timestamps do not emit summary changes');
 await publish({nav:{incoming:1},listRevision:'membership-two'});assert.notEqual(await signal(),ready,'equal totals but changed membership still notify');
 const changed=await signal();now+=3001;await healthy();assert.notEqual(await signal(),changed,'expiry without a source mutation signals stale');
 await publish({nav:{incoming:1},listRevision:'membership-two'});assert.equal(await signal(),changed,'ready recovery signals even with unchanged data/source');
 await d.prepare('UPDATE crm_model_worker SET ok=0').run();assert.notEqual(await signal(),changed,'worker failure changes readiness');await healthy();assert.equal(await signal(),changed);
 await d.prepare("UPDATE employees SET data=json_set(data,'$.department','new') WHERE id='private-actor'").run();assert.notEqual(await signal(),changed,'access invalidation cannot retain a ready private signal');
 source=await readModelSource(d);await publish({nav:{incoming:0},listRevision:'new-access'});assert.notEqual(await signal(),changed);
 console.log('Summary SSE signal: opaque hash, content/membership, missing/error, expiry, worker outage/recovery, access and timestamp-only republish semantics passed');
}finally{d.close();}

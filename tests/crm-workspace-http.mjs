// 100 distinct synthetic sessions, local standalone runtime, no external integrations.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-workspace-http-')),file=join(dir,'test.sqlite'),database=new DatabaseSync(file);
const port=process.env.WORKSPACE_TEST_PORT||'3131',base=`http://127.0.0.1:${port}`,streams=[],cookies=[];
const webhookKey='synthetic-webhook-key-only-0123456789abcdef';
let server,logs='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,message)=>{const start=performance.now();while(!predicate()){assert.ok(performance.now()-start<8000,message);await pause(20);}};
try{
 database.exec('PRAGMA journal_mode=WAL');database.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)database.exec(sql);
 const now=new Date().toISOString();
 for(let i=0;i<100;i++){
  const id='operator-'+i,token=randomBytes(32).toString('hex');
  database.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role:'operator',department:String(i%2+1),salary:0,bonus:0}));
  database.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,'unused-synthetic-password-hash');
  database.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);cookies.push('__Host-sm-session='+token);
  const c={id:'c-'+i,name:'Synthetic '+i,phone:'+7999'+String(i).padStart(7,'0'),owner:id,city:'Москва',address:'',source:'Fixture',createdAt:now,assignedUntil:''};
  database.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+i,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now};
  database.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 database.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_MAINTENANCE_WORKER:'1',CRM_SK_WEBHOOK_KEY:webhookKey,CRM_ORIGIN:base,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<200;i++){try{await fetch(base+'/login');break;}catch{await pause(100);}}
 const read=(i,path='?list=orders&view=orders&filter=all',etag='')=>fetch(base+'/api/crm'+path,{headers:{cookie:cookies[i],...(etag?{'If-None-Match':etag}:{})}});
 // Initialize lazy auxiliary tables before testing stable source revisions.
 for(const part of ['context','tasks'])assert.equal((await read(0,'?part='+part)).status,200);
 async function connect(i,cursor=''){
  const controller=new AbortController(),state={controller,frames:[],ended:false};streams.push(state);
  const response=await fetch(base+'/api/crm/changes?scope=workspace',{headers:{cookie:cookies[i],...(cursor?{'Last-Event-ID':cursor}:{})},signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader();let buffer='';
  state.pump=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);for(let cut;(cut=buffer.indexOf('\n\n'))>=0;){const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);if(frame.includes('event:'))state.frames.push({frame,at:performance.now()});}}}catch(error){if(!controller.signal.aborted)throw error;}finally{state.ended=true;}})();
  return state;
 }
 const active=await Promise.all(cookies.map((_,i)=>connect(i)));await until(()=>active.every(s=>s.frames.length===1),'initial events');
 for(const s of active){const data=JSON.parse(s.frames[0].frame.split('data: ')[1]);assert.deepEqual(Object.keys(data),['workspace','tasks','cards']);assert.ok(!JSON.stringify(data).includes('operator-'),'no entity identifiers');}
 const cached=await read(0),etag=cached.headers.get('etag');assert.equal(cached.status,200);await cached.arrayBuffer();
 assert.equal((await read(0,undefined,etag)).status,304);
 const start=performance.now();database.prepare("UPDATE orders SET data=json_set(data,'$.comment','external write'),version=version+1 WHERE id='o-0'").run();
 await until(()=>active[0].frames.length===2,'own change');await pause(1100);
 assert.ok(active.slice(1).every(s=>s.frames.length===1),'99 foreign operators receive no change event');
 assert.equal((await read(0,undefined,etag)).status,200);
 const latencies=[];
 await Promise.all(cookies.map(async(_,i)=>{const began=performance.now(),r=await read(i);assert.equal(r.status,200);const body=await r.json();assert.equal(body.rows.length,1);assert.equal(body.rows[0].id,'o-'+i);latencies.push(performance.now()-began);}));
 const cursor=active[0].frames.at(-1).frame.match(/id: (.+)/)[1];active[0].controller.abort();
 database.prepare("UPDATE clients SET version=version+1 WHERE id='c-0'").run();const recovered=await connect(0,cursor);await until(()=>recovered.frames.length===1,'reconnect recovers missed change');assert.notEqual(recovered.frames[0].frame.match(/id: (.+)/)[1],cursor);
 database.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='operator-1'").run();await until(()=>active[1].ended,'revoked stream closes');assert.equal((await read(1)).status,401);
 database.prepare("UPDATE employees SET data=json_set(data,'$.department','2') WHERE id='operator-0'").run();await until(()=>recovered.frames.some(f=>f.frame.includes('event: access')),'rights change requires fresh bootstrap');
 const version=database.prepare("SELECT version FROM orders WHERE id='o-2'").get().version;
 const save=body=>fetch(base+'/api/crm',{method:'POST',headers:{cookie:cookies[2],Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const saved=await save({action:'comment',id:'o-2',version,text:'Independent workspace save',responseMode:'entity-patch-v2'});
 assert.equal(saved.status,200);const patch=(await saved.json()).entityPatch;assert.equal(patch.deferredWorkspace,true);
 assert.equal(patch.state.orders.length,1);assert.equal(patch.state.orders[0].id,'o-2');assert.ok(patch.state.orders[0].version>version);
 for(const key of ['tasks','reminders','clientReminders','clientWork'])assert.equal(patch.state[key],undefined,'save response does not rebuild '+key);
 assert.ok(Array.isArray(patch.state.incoming),'incoming permissions are rechecked in the patch');
 assert.equal((await read(2,'?part=tasks')).status,200,'independent tasks remain available after the save');
 assert.equal((await save({action:'comment',id:'o-2',version,text:'Stale overwrite',responseMode:'entity-patch-v2'})).status,400);
 assert.equal((await save({action:'comment',id:'o-3',version:1,text:'Foreign write',responseMode:'entity-patch-v2'})).status,403);
 const legacySave=await save({action:'comment',id:'o-2',version:patch.state.orders[0].version,text:'Compatible save',responseMode:'entity-patch'});
 assert.equal(legacySave.status,200);assert.ok(Array.isArray((await legacySave.json()).entityPatch.state.tasks),'existing patch clients retain the full contract');
 database.prepare("INSERT INTO settings(id,data) VALUES('sk-order-import',?)").run(JSON.stringify({enabled:true,resultIds:[47]}));
 const callback=authorization=>fetch(base+'/api/sk-order-events',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'synthetic-event-1',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({type:'call_result',call:{id:123,result_id:47},call_result:{result_id:47,comment:'Synthetic import'}})});
 assert.equal((await callback()).status,403,'provider endpoint cannot rely on browser cookies or an absent key');
 assert.equal((await callback('Bearer wrong')).status,403);
 assert.equal((await callback('Bearer '+webhookKey)).status,200,'authenticated provider event is durably accepted without browser session');
 assert.equal((await callback('Bearer '+webhookKey)).status,200);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM sk_order_events').get().n,1,'HTTP retry does not duplicate queued work');
 const batch=[{type:'call_result',call:{id:124},call_result:{result_id:47},custom_fields:{unused:'x'.repeat(70000)}},{type:'call_result',call:{id:125},call_result:{result_id:47}},{type:'form_response'}];
 const postBatch=()=>fetch(base+'/api/sk-order-events',{method:'POST',headers:{Authorization:'Bearer '+webhookKey,'Content-Type':'application/json','Idempotency-Key':'synthetic-batch'},body:JSON.stringify(batch)});
 assert.equal((await postBatch()).status,200);assert.equal((await postBatch()).status,200);
 assert.equal(database.prepare('SELECT COUNT(*) n FROM sk_order_events').get().n,3,'HTTP batch accepts large unused fields, ignores form events and preserves retries');
 database.exec("CREATE TRIGGER synthetic_webhook_failure BEFORE INSERT ON sk_order_events WHEN NEW.call_id='127' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 batch[0].call.id=126;batch[1].call.id=127;
 assert.equal((await postBatch()).status,503,'failed persistence never acknowledges delivery');
 assert.equal(database.prepare('SELECT COUNT(*) n FROM sk_order_events').get().n,3,'HTTP batch write failure rolls back all new rows');
 database.exec('DROP TRIGGER synthetic_webhook_failure');
 assert.equal(database.prepare("SELECT COUNT(*) n FROM orders WHERE id NOT LIKE 'o-%'").get().n,0,'HTTP ingress never invokes provider APIs or imports synchronously');
 latencies.sort((a,b)=>a-b);
 const result={synthetic:true,distinctSessions:100,concurrentSse:100,concurrentListRequests:100,ownChangeMs:active[0].frames[1].at-start,foreignEvents:0,listP50Ms:latencies[49],listP95Ms:latencies[94],listMaxMs:latencies[99],reconnect:true,revocation:true,rightsReset:true,fast304:true,note:'Small fixture: one order/client per actor. This is protocol/concurrency validation, not production capacity certification.'};
 if(process.env.WORKSPACE_TEST_OUTPUT)writeFileSync(process.env.WORKSPACE_TEST_OUTPUT,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs);throw error;}finally{
 streams.forEach(s=>s.controller.abort());await Promise.allSettled(streams.map(s=>s.pump));if(server&&server.exitCode===null){server.kill();await once(server,'exit');}database.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-workspace-http-'));rmSync(dir,{recursive:true,force:true});
}

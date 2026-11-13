import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../server/sqlite.ts';
import {receiveSkOrderEvent,initSkOrderEvents} from '../lib/sk-order-events.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
import {syncLvIncoming} from '../lib/lv-incoming-sync.ts';
import {skProviderRequest,SkProviderDeferred} from '../lib/sk-provider-request.ts';
import {workspaceVersions} from '../lib/crm-workspace-clock.ts';
const secret='synthetic-webhook-key-'.repeat(3),folder=mkdtempSync(join(tmpdir(),'crm-sk-events-')),path=join(folder,'test.sqlite');
let d=openDatabase(path),now=Date.now(),unfinished=new Set(),reports=0,providerCalls=0;
const config={enabled:true,enabledAt:new Date(now-3600000).toISOString(),resultIds:[123]};
const event=id=>({type:'call_result',call:{id,result_id:123},call_result:{result_id:123,comment:'fixture'}});
const request=(body=event(1),headers={})=>new Request('https://fixture.invalid/api/sk-order-events',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json','idempotency-key':'fixture-'+body?.call?.id,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const put=async(id,value)=>d.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,JSON.stringify(value)).run();
const api=async(url,init)=>{
 providerCalls++;const u=new URL(url),id=Number(u.pathname.split('/').at(-1));
 if(u.pathname==='/oauth/token')return Response.json({access_token:'fixture'});
 if(u.pathname==='/api/v2/users')return Response.json([{id:7,name:'Operator',email:'fixture@example.invalid'}]);
 if(u.pathname==='/api/reports/calls_total.json'){reports++;return Response.json({data:[{id:900,scenario_result:{id:123},comment:'late result'}],total_pages:1});}
 if(u.pathname.startsWith('/api/v2/calls/'))return Response.json({id,result_id:123,user_id:7,lead_id:id,started_at:new Date(now-(id===901?7200000:10000)).toISOString(),ended_at:unfinished.has(id)?null:new Date(now).toISOString(),direction:'out',phone:'+7999'+String(id).padStart(7,'0')});
 if(u.pathname.startsWith('/api/v2/leads/'))return Response.json({id,name:'Synthetic '+id,address:'Fixture address',lead_phones:['+7999'+String(id).padStart(7,'0')]});
 throw Error('Unexpected provider path');
};
const tick=()=>syncSkOrders(d,api,Date.now(),undefined,true);
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind('op',JSON.stringify({id:'op',name:'Operator',login:'op',skLogin:'Operator',role:'operator',department:'1',version:1})).run();
 await put('skorozvon',{login:'fixture',apiKey:'fixture',clientId:'fixture',clientSecret:'fixture'});await put('sk-order-import',config);
 assert.equal((await receiveSkOrderEvent(d,request(),'' )).status,403);
 assert.equal((await receiveSkOrderEvent(d,request(event(1),{authorization:'Bearer wrong'}),secret)).status,403);
 assert.equal((await receiveSkOrderEvent(d,request(event(1),{'content-type':'text/plain'}),secret)).status,415);
 assert.equal((await receiveSkOrderEvent(d,request(event(1),{'idempotency-key':''}),secret)).status,400);
 assert.equal((await receiveSkOrderEvent(d,request('x'.repeat(20*1024*1024+1)),secret)).status,413);
 assert.equal((await receiveSkOrderEvent(d,request({...event(1),call_result:{result_id:null}}),secret)).status,400);
 await put('sk-order-import',{...config,enabled:false});assert.equal((await receiveSkOrderEvent(d,request(),secret)).status,503);await put('sk-order-import',config);
 assert.equal((await receiveSkOrderEvent(d,request({...event(1),call:{id:1,result_id:999},call_result:{result_id:999}}),secret)).status,200);
 await initSkOrderEvents(d);assert.equal((await d.prepare('SELECT COUNT(*) n FROM sk_order_events').first()).n,0);
 assert.equal((await receiveSkOrderEvent(d,request(),secret)).status,200);assert.equal((await receiveSkOrderEvent(d,request(),secret)).status,200);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM sk_order_events').first()).n,1);
 assert.equal((await receiveSkOrderEvent(d,request({...event(9999),call_result:{result_id:123,comment:'x'.repeat(4000)}}),secret)).status,200);
 assert.equal((await d.prepare("SELECT length(comment) n FROM sk_order_events WHERE call_id='9999'").first()).n,3000,'long comments use the same truncation as the original importer');
 await d.prepare("DELETE FROM sk_order_events WHERE call_id='9999'").run();
 assert.equal((await receiveSkOrderEvent(d,request(event(2),{'idempotency-key':'fixture-1'}),secret)).status,409);
 // A stalled LV HTTP call has no ownership of the SK consumer or its report path.
 await put('lv-incoming-import',{enabled:true,statusId:58});await put('lv-warehouse',{host:'fixture.leadvertex.ru',token:'fixture'});
 let releaseLv;const lv=syncLvIncoming(d,async()=>new Promise(resolve=>{releaseLv=()=>resolve(Response.json([]));}));
 while(!releaseLv)await new Promise(resolve=>setTimeout(resolve,1));
 const oneStarted=performance.now();assert.equal((await tick()).imported,1);const immediateMs=performance.now()-oneStarted;
 assert.equal(reports,0);assert.equal((await d.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);releaseLv();await lv;
 const actor={id:'op',role:'operator',department:'1'},versions=await workspaceVersions(d,actor);
 await d.prepare("UPDATE sk_order_event_health SET data=json_set(data,'$.at','changed-health-only') WHERE id=1").run();
 assert.deepEqual(await workspaceVersions(d,actor),versions,'event health must not invalidate employee data');
 assert.equal((await tick()).imported,0);
 // A report in flight cannot block the independently paced call/lead event path.
 let finishReport;const report=skProviderRequest(d,async()=>new Promise(resolve=>{finishReport=()=>resolve(Response.json({data:[]}));}),'https://api.skorozvon.ru/api/reports/calls_total.json',{},Date.now,ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 while(!finishReport)await new Promise(resolve=>setTimeout(resolve,1));
 await assert.rejects(skProviderRequest(d,api,'https://api.skorozvon.ru/api/reports/calls_total.json',{},Date.now,ms=>new Promise(resolve=>setTimeout(resolve,ms))),SkProviderDeferred);
 await receiveSkOrderEvent(d,request(event(2)),secret);assert.equal((await tick()).imported,1);finishReport();await report;
 assert.equal(await d.prepare('SELECT report_token FROM sk_api_control').first('report_token'),'');
 // No premature import before ended_at; after a crash its durable lease expires and retries.
 unfinished.add(3);await receiveSkOrderEvent(d,request(event(3)),secret);assert.equal((await tick()).imported,0);
 assert.equal(await d.prepare("SELECT id FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='3')").first(),null);
 await d.prepare("UPDATE sk_order_events SET lease_token='crashed',lease_until=?,next_at=0 WHERE call_id='3'").bind(Date.now()+200).run();
 d.close();d=openDatabase(path);unfinished.delete(3);await new Promise(resolve=>setTimeout(resolve,220));assert.equal((await tick()).imported,1);
 await receiveSkOrderEvent(d,request(event(901)),secret);assert.equal((await tick()).imported,0,'calls before enablement stay excluded');
 // Fallback preserves the overlapping report and catches events whose webhook was never received.
 assert.equal((await syncSkOrders(d,api,Date.now())).imported,1);assert.equal(reports,1);
 // 429 from the fast consumer pauses the reconciliation consumer too, before further external requests.
 await receiveSkOrderEvent(d,request(event(4)),secret);
 const limited=async(url,init)=>new URL(url).pathname.startsWith('/api/v2/calls/')?new Response('',{status:429,headers:{'Retry-After':'120'}}):api(url,init);
 await assert.rejects(syncSkOrders(d,limited,Date.now(),undefined,true));
 const retry=await d.prepare('SELECT retry_at FROM sk_api_control').first('retry_at');assert.ok(retry>=Date.now()+119000);
 const before=providerCalls;await syncSkOrders(d,async()=>assert.fail('shared cooldown'),Date.now(),async()=>{},false);assert.equal(providerCalls,before);
 await d.prepare('UPDATE sk_api_control SET retry_at=0,next_at=0').run();await d.prepare("UPDATE sk_order_events SET next_at=0 WHERE call_id='4'").run();assert.equal((await tick()).imported,1);
 const ordinary=[];
 for(let id=50;id<60;id++){const started=performance.now();await receiveSkOrderEvent(d,request(event(id)),secret);assert.equal((await tick()).imported,1);ordinary.push(performance.now()-started);}
 // Timed synthetic 47-operator burst: real pacing/SQLite, fake provider responses, no network or UI claims.
 const enqueueMs=[],received=Date.now();
 for(let id=100;id<147;id++){const started=performance.now();assert.equal((await receiveSkOrderEvent(d,request(event(id)),secret,received)).status,200);enqueueMs.push(performance.now()-started);}
 while(await d.prepare('SELECT call_id FROM sk_order_events WHERE done_at IS NULL LIMIT 1').first())await tick();
 const ages=(await d.prepare("SELECT done_at-received_at AS ms FROM sk_order_events WHERE CAST(call_id AS INTEGER) BETWEEN 100 AND 146 ORDER BY ms").all()).results.map(r=>r.ms),sorted=enqueueMs.sort((a,b)=>a-b),p=(values,q)=>values[Math.ceil(values.length*q)-1];
 ordinary.sort((a,b)=>a-b);
 console.log(JSON.stringify({synthetic:true,operators:47,provider:'mock',timerWaitRemoved:true,firstColdEventConsumerMs:Math.round(immediateMs),singleEventReceiptToCommitMs:{n:ordinary.length,p50:p(ordinary,.5),p95:p(ordinary,.95),max:ordinary.at(-1),daemonTickWaitExcluded:true},enqueueMs:{p50:p(sorted,.5),p95:p(sorted,.95),max:sorted.at(-1)},simultaneousBurstReceiptToCommitMs:{p50:p(ages,.5),p95:p(ages,.95),max:ages.at(-1)},providerCalls,reports}));
 assert.equal(ages.length,47);assert.ok(sorted.at(-1)<1000,'HTTP enqueue must not wait for provider');
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM orders').first()).n,62);
 // Larger correctness/replay burst uses a virtual wait clock, not a claimed wall-time measurement.
 let virtual=Date.now()+60000;
 for(let id=1000;id<1100;id++)assert.equal((await receiveSkOrderEvent(d,request(event(id)),secret,virtual)).status,200);
 while(await d.prepare('SELECT call_id FROM sk_order_events WHERE done_at IS NULL LIMIT 1').first())await syncSkOrders(d,api,virtual,async ms=>{virtual+=ms;},true);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM orders').first()).n,162);
 for(let id=1000;id<1100;id++)await receiveSkOrderEvent(d,request(event(id)),secret,virtual);
 assert.equal((await syncSkOrders(d,api,virtual,async()=>{},true)).imported,0);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM orders').first()).n,162);
 // Capacity failure is retryable and retains all prior rows; existing duplicates still ACK.
 await d.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO sk_order_events(call_id,event_key,result_id,comment,received_at) SELECT 'full-'||x,'full-'||x,'123','',0 FROM n").run();
 assert.equal((await receiveSkOrderEvent(d,request(event(999)),secret)).status,503);
 assert.equal((await receiveSkOrderEvent(d,request(event(1)),secret)).status,200);
 console.log('SK events: authenticated bounded durable queue, duplicate/restart/unfinished/old calls, LV isolation, report lease, fallback, shared 429 and 47-operator burst passed');
}finally{d.close();rmSync(folder,{recursive:true,force:true});}

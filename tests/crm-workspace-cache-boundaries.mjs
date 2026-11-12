import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {cachedWorkspaceResponse,orderListNextChange} from '../lib/crm-workspace-cache.ts';
import {readModelSource,publishPreparedModels} from '../lib/crm-read-model.ts';
import {defaultOrderPolicy} from '../lib/order-policy.ts';
const d=openDatabase(':memory:'),wallClock=Date.now,flag=process.env.CRM_SUMMARIES_WORKER;
let now=Date.parse('2026-11-12T12:00:04.990Z');Date.now=()=>now;process.env.CRM_SUMMARIES_WORKER='1';
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const actor={id:'op',role:'operator',department:'1'};await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(actor.id,JSON.stringify(actor)).run();
 const source=await readModelSource(d);
 async function finance(){await publishPreparedModels(d,[{kind:'finance-meta',scope:'global',data:{},sourceRevision:source.financeRevision,accessRevision:source.accessRevision,computedAt:now,validUntil:now+30000}]);await d.prepare('UPDATE crm_model_worker SET ok=1,heartbeat=?').bind(now).run();}
 await finance();let builds=0;
 const request=new Request('http://local/api/crm?list=orders'),state={orders:[],clients:[],employees:[actor],events:[],settings:{retentionDays:30,orderPolicy:defaultOrderPolicy}};
 const build=()=>{builds++;return Promise.resolve(Response.json({builds},{headers:{'X-CRM-Cache-Until':String(orderListNextChange(state,now))}}));};
 const read=req=>cachedWorkspaceResponse(d,actor,req||request,'workspace',{list:'orders'},build);
 const first=await read(),etag=first.headers.get('etag');assert.equal(first.headers.get('X-CRM-Cache-Until'),null);
 now+=20;assert.equal((await read(new Request(request,{headers:{'If-None-Match':etag}}))).status,304,'crossing a global 5s bucket does not rebuild unchanged content');assert.equal(builds,1);
 now+=6000;await finance();assert.equal((await read(new Request(request,{headers:{'If-None-Match':etag}}))).status,304,'unchanged finance republishing does not invalidate content');assert.equal(builds,1);
 await d.prepare('UPDATE crm_model_worker SET ok=0').run();await read();assert.equal(builds,2,'financial readiness still invalidates cached ready data');
 await finance();assert.equal((await read(new Request(request,{headers:{'If-None-Match':etag}}))).status,304);
 const cutoff=now+1000;let dueBuilds=0;
 const dueRead=req=>cachedWorkspaceResponse(d,actor,req||request,'workspace',{list:'orders',filter:'deadline'},async()=>{dueBuilds++;return Response.json({due:now>=cutoff},{headers:{'X-CRM-Cache-Until':String(now<cutoff?cutoff:now+100000)}});});
 const before=await dueRead();now=cutoff;const after=await dueRead(new Request(request,{headers:{'If-None-Match':before.headers.get('etag')}}));assert.equal(after.status,200);assert.deepEqual(await after.json(),{due:true});assert.equal(dueBuilds,2,'time-only boundary recomputes before conditional response');
 const shifted={...state,orders:[{status:'rework',reworkDeadline:new Date(now+defaultOrderPolicy.reworkWarningHours*3600000+1234).toISOString()}]};
 assert.equal(orderListNextChange(shifted,now),now+1234);
 assert.equal(orderListNextChange({...state,orders:[{status:'confirm',confirmationRequest:{at:new Date(now+300000+2000).toISOString()}}]},now),now+2000);
 assert.equal(orderListNextChange(state,Date.parse('2026-11-12T20:59:59Z')),Date.parse('2026-11-12T21:00:00Z'));
 let taskBuilds=0;const tasks=()=>cachedWorkspaceResponse(d,actor,request,'tasks',{},async()=>{taskBuilds++;return Response.json({taskBuilds});});
 await tasks();await d.prepare('UPDATE crm_model_worker SET ok=0').run();await tasks();assert.equal(taskBuilds,1,'tasks do not depend on prepared financial readiness');now+=5001;await tasks();assert.equal(taskBuilds,2,'unclassified time-sensitive responses retain conservative expiration');
 console.log('Workspace cache: no bucket/financial timestamp churn, real readiness and deadline invalidation, midnight, conditional freshness and task independence passed');
}finally{Date.now=wallClock;if(flag===undefined)delete process.env.CRM_SUMMARIES_WORKER;else process.env.CRM_SUMMARIES_WORKER=flag;d.close();}

import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
import {crmcallsContact,crmcallsPlan,crmcallsProjects,crmcallsApi,crmcallsScheduleSchema} from '../lib/crmcalls.ts';
import {initCRMCalls,saveCRMCallsSchedule,previewCRMCalls,runCRMCalls,crmcallsDashboard,saveCRMCallsKey} from '../lib/crmcalls-store.ts';

const project='11111111-1111-4111-8111-111111111111',importId='22222222-2222-4222-8222-222222222222';
const s={projectId:project,base:'M',sheet:'П',cycleDays:2,sendTime:'09:00',enabled:true};
const before=new Date('2026-11-20T05:00:00Z'),friday=new Date('2026-11-20T06:01:00Z'),monday=new Date('2026-11-23T06:01:00Z');
assert.deepEqual(crmcallsPlan(5,2,'2026-11-20'),[{date:'2026-11-20',count:3},{date:'2026-11-23',count:2}]);
assert.equal(crmcallsPlan(10001,10,'2026-11-21').reduce((n,p)=>n+p.count,0),10001);
assert.equal(crmcallsPlan(2,10,'2026-11-21')[0].date,'2026-11-23');
assert.equal(crmcallsScheduleSchema.safeParse({...s,cycleDays:0}).success,false);
assert.equal(crmcallsScheduleSchema.safeParse({...s,sheet:'ЧС'}).success,false);
assert.deepEqual(crmcallsContact({id:'c',name:'Иванов Иван',phone:'8 (999) 123-45-67',linkedPhones:['+79991234567','79991234568','bad'],city:'Москва',address:'ул. Лесная, д. 1'}),{external_id:'c',full_name:'Иванов Иван',phones:['79991234567','79991234568'],city:'Москва',address:'ул. Лесная, д. 1'});
async function fixture(){
 const d=openDatabase(':memory:');
 for(const sql of ['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT UNIQUE,data TEXT,version INTEGER DEFAULT 1)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)'])await d.prepare(sql).run();
 await initCRMCalls(d);
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('base-settings',JSON.stringify({config:initialBaseSettings()})).run();
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('crmcalls-connection',JSON.stringify({apiKey:'private-test-key',revision:'key-v1'})).run();
 for(let i=0;i<8;i++){const c={id:'c'+i,name:'Иванов '+i,phone:'7999123456'+i,city:'Москва',address:'ул. Лесная, д. '+i,baseType:'M',sheet:'П',owner:i===5?'operator':'',releasedAt:i===6?before.toISOString():undefined};await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c)).run();}
 await d.prepare('INSERT INTO orders VALUES(?,?,?)').bind('order','c7',JSON.stringify({status:'draft'})).run();
 return d;
}
function mock({bad=false,partial=false,timeout=false,reject=false}={}){
 let contacts=[],posts=0;
 return {get posts(){return posts;},request:async(url,options={})=>{
  assert.equal(new URL(url).origin,'https://cc.crmcalls.ru');
  if(url.includes('/projects'))return Response.json({data:[{id:project,name:'Тест',status:'draft'}],pagination:{total_pages:1}});
  if(options.method==='POST'){posts++;const body=JSON.parse(options.body);assert.equal(body.project_id,project);assert.deepEqual(body.deduplication,{mode:'update',on_multiple_phone_matches:'error'});contacts=body.contacts.map(c=>({...c,id:'remote-'+c.external_id}));if(timeout)throw Error('network');if(reject)return Response.json({}, {status:429});return Response.json({data:{import_id:importId,state:'queued'}});}
  if(url.includes('/contacts/import/'))return Response.json({data:{state:partial?'completed_with_errors':'completed',processed_count:contacts.length,invalid_count:partial?1:0,project:{id:project,added:contacts.length,already_in_project:0,failed:0}}});
  return Response.json({data:contacts.map(c=>bad?{...c,address:'Неверный адрес'}:c),pagination:{total_pages:1}});
 }};
}
const d=await fixture(),m=mock();
assert.equal((await previewCRMCalls(d,s,before)).rows.length,5);
const original=(await d.prepare('SELECT data FROM clients ORDER BY id').all()).results;
const queued=await saveCRMCallsSchedule(d,s,'',before);assert.equal(queued.queued,5);
await assert.rejects(()=>saveCRMCallsSchedule(d,s,'',before),/изменились/);
assert.equal((await crmcallsDashboard(d)).plan.length,2);
assert.ok(!JSON.stringify(await crmcallsDashboard(d)).includes('private-test-key'));
await runCRMCalls(d,m.request,new Date('2026-11-20T05:59:00Z'));assert.equal(m.posts,0);
await runCRMCalls(d,m.request,friday);assert.equal(m.posts,1);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='submitted'").first()).n,3);
await assert.rejects(()=>d.prepare("UPDATE clients SET data=json_set(data,'$.owner','op') WHERE id='c0'").run(),/CRMCalls/);
await runCRMCalls(d,m.request,friday);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,3);
await runCRMCalls(d,m.request,friday);assert.equal(m.posts,1);
await runCRMCalls(d,m.request,new Date('2026-11-21T10:00:00Z'));assert.equal(m.posts,1);
await runCRMCalls(d,m.request,monday);await runCRMCalls(d,m.request,monday);assert.equal(m.posts,2);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,5);
assert.deepEqual((await d.prepare('SELECT data FROM clients ORDER BY id').all()).results,original,'Export must not alter source clients or SK fields');
const next=await previewCRMCalls(d,s,monday);assert.ok(!next.rows.some(r=>['c0','c1','c2','c3','c4'].includes(r.id)),'No repeat exports to the same project');
await assert.rejects(()=>saveCRMCallsKey(d,'new-key','key-v1',async()=>Response.json({data:[],pagination:{total_pages:0}})),/не видит/);
d.close();
for(const mode of ['timeout','partial','bad','reject']){
 const db=await fixture(),remote=mock({[mode]:true});await saveCRMCallsSchedule(db,s,'',before);await runCRMCalls(db,remote.request,friday);
 if(mode==='bad')await assert.rejects(()=>runCRMCalls(db,remote.request,friday),/адрес/);
 else if(mode!=='reject')await runCRMCalls(db,remote.request,friday);
 assert.equal(remote.posts,1);
 const state=(await db.prepare('SELECT state FROM crmcalls_batches LIMIT 1').first()).state;
 assert.equal(state,mode==='bad'?'submitted':mode==='reject'?'rejected':'unknown');
 if(mode==='timeout'||mode==='partial'){await runCRMCalls(db,remote.request,monday);assert.equal(remote.posts,1);}
 db.close();
}
const changed=await fixture(),remote=mock();await saveCRMCallsSchedule(changed,s,'',before);
await changed.prepare("UPDATE clients SET data=json_set(data,'$.owner','op'),version=version+1 WHERE id='c0'").run();
await runCRMCalls(changed,remote.request,friday);await runCRMCalls(changed,remote.request,friday);
assert.equal((await changed.prepare("SELECT state FROM crmcalls_items WHERE client_id='c0'").first()).state,'skipped');
assert.equal((await changed.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,2);
changed.close();
const late=await fixture(),lateMock=mock();await saveCRMCallsSchedule(late,s,'',before);
await runCRMCalls(late,lateMock.request,monday);await runCRMCalls(late,lateMock.request,monday);await runCRMCalls(late,lateMock.request,monday);
assert.equal(lateMock.posts,1,'Downtime must not exceed the daily cap');
assert.equal((await late.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,3);
await assert.rejects(()=>saveCRMCallsSchedule(late,{...s,projectId:importId},'',before),/другом проекте/);
late.close();
const crash=await fixture();await saveCRMCallsSchedule(crash,s,'',before);
await crash.prepare("INSERT INTO crmcalls_batches(id,project,state,created_at) VALUES('crash',?,'sending',?)").bind(project,friday.toISOString()).run();
await crash.prepare("UPDATE crmcalls_items SET state='sending',batch_id='crash' WHERE client_id='c0'").run();
await runCRMCalls(crash,async()=>{throw Error('Must never repeat POST after a crash');},monday);
assert.equal((await crash.prepare("SELECT state FROM crmcalls_batches WHERE id='crash'").first()).state,'unknown');crash.close();
const mutual=await fixture();
await mutual.prepare("CREATE TABLE base_dispatch_items(job_id TEXT,client_id TEXT,state TEXT)").run();await initCRMCalls(mutual);await saveCRMCallsSchedule(mutual,s,'',before);
await mutual.prepare("INSERT INTO base_dispatch_items VALUES('sk','c0','pending')").run();
await mutual.prepare("UPDATE crmcalls_items SET state='sending' WHERE client_id='c0'").run();
assert.equal((await mutual.prepare("SELECT state FROM crmcalls_items WHERE client_id='c0'").first()).state,'pending');
await mutual.prepare("UPDATE crmcalls_items SET state='sending' WHERE client_id='c1'").run();
await mutual.prepare("INSERT INTO base_dispatch_items VALUES('sk','c1','pending')").run();
assert.equal((await mutual.prepare("SELECT COUNT(*) AS n FROM base_dispatch_items WHERE client_id='c1'").first()).n,0);mutual.close();
await assert.rejects(()=>crmcallsProjects(crmcallsApi('key',async()=>Response.json({data:[{id:project,name:'a',status:'draft'}],pagination:{total_pages:2}}))),/повторил/);
console.log('CRMCalls: fields, custom cycles, 5/2, exclusions, CAS, secret masking, verified import, no repeats, uncertain/partial/mismatched responses and rate limits passed');

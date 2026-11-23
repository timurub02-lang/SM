import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {distributionCandidates,queueBaseDispatch,initBaseDispatch} from '../lib/base-dispatch.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
import {crmcallsContact,crmcallsPlan,crmcallsProjects,crmcallsApi,crmcallsScheduleSchema} from '../lib/crmcalls.ts';
import {initCRMCalls,saveCRMCallsSchedule,previewCRMCalls,runCRMCalls,crmcallsDashboard,saveCRMCallsKey} from '../lib/crmcalls-store.ts';

const project='11111111-1111-4111-8111-111111111111',importId='22222222-2222-4222-8222-222222222222';
const s={projectId:project,base:'M',sheet:'П',cycleDays:2,sendTime:'09:00',enabled:true};
const before=new Date('2026-11-20T05:00:00Z'),friday=new Date('2026-11-20T06:01:00Z'),monday=new Date('2026-11-23T06:01:00Z');
assert.deepEqual(crmcallsPlan(5,2,'2026-11-20'),[{date:'2026-11-20',count:2},{date:'2026-11-23',count:2}]);
assert.equal(crmcallsPlan(10001,10,'2026-11-21').reduce((n,p)=>n+p.count,0),10000);
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
const queued=await saveCRMCallsSchedule(d,s,'',before);assert.equal(queued.queued,0);
await assert.rejects(()=>saveCRMCallsSchedule(d,s,'',before),/изменились/);
assert.equal((await crmcallsDashboard(d)).plan.length,0);
assert.ok(!JSON.stringify(await crmcallsDashboard(d)).includes('private-test-key'));
await runCRMCalls(d,m.request,new Date('2026-11-20T05:59:00Z'));assert.equal(m.posts,0);
await runCRMCalls(d,m.request,friday);assert.equal(m.posts,1);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='submitted'").first()).n,2);
await assert.rejects(()=>d.prepare("UPDATE clients SET data=json_set(data,'$.owner','op') WHERE id='c0'").run(),/CRMCalls/);
await runCRMCalls(d,m.request,friday);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,2);
await runCRMCalls(d,m.request,friday);assert.equal(m.posts,1);
await runCRMCalls(d,m.request,new Date('2026-11-21T10:00:00Z'));assert.equal(m.posts,1);
await runCRMCalls(d,m.request,monday);await runCRMCalls(d,m.request,monday);assert.equal(m.posts,2);
assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,4);
const after=(await d.prepare('SELECT data FROM clients ORDER BY id').all()).results;
for(let i=0;i<after.length;i++){const c=JSON.parse(after[i].data);if(i<4){assert.equal(c.distributedAt,i<2?'2026-11-23':'2026-11-24');delete c.distributedAt;}assert.deepEqual(c,JSON.parse(original[i].data),'Only the common distribution date changes');}
assert.deepEqual((await distributionCandidates(d,'M','П','2026-11-23')).map(r=>r.id),['c4','c0','c1','c2','c3'],'Both providers prioritize clients never sent, then oldest distribution');
const next=await previewCRMCalls(d,s,monday);assert.ok(!next.rows.some(r=>['c0','c1','c2','c3'].includes(r.id)),'No repeat exports to the same project');
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
assert.equal(await changed.prepare("SELECT state FROM crmcalls_items WHERE client_id='c0'").first(),null);
assert.equal((await changed.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,2);
changed.close();
const late=await fixture(),lateMock=mock();await saveCRMCallsSchedule(late,s,'',before);
await runCRMCalls(late,lateMock.request,monday);await runCRMCalls(late,lateMock.request,monday);await runCRMCalls(late,lateMock.request,monday);
assert.equal(lateMock.posts,1,'Downtime must not exceed the daily cap');
assert.equal((await late.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,2);
await assert.rejects(()=>saveCRMCallsSchedule(late,{...s,projectId:importId},'',before),/другом проекте/);
late.close();
const crash=await fixture();await saveCRMCallsSchedule(crash,s,'',before);
await crash.prepare("INSERT INTO crmcalls_batches(id,project,state,created_at) VALUES('crash',?,'sending',?)").bind(project,friday.toISOString()).run();
await crash.prepare("INSERT INTO crmcalls_items(project,client_id,cycle,day,state,data,batch_id) VALUES(?,'c0','test','2026-11-20','sending','{}','crash')").bind(project).run();
await runCRMCalls(crash,async()=>{throw Error('Must never repeat POST after a crash');},monday);
assert.equal((await crash.prepare("SELECT state FROM crmcalls_batches WHERE id='crash'").first()).state,'unknown');crash.close();
const mutual=await fixture();
await mutual.prepare("CREATE TABLE base_dispatch_items(job_id TEXT,client_id TEXT,state TEXT)").run();await initCRMCalls(mutual);await saveCRMCallsSchedule(mutual,s,'',before);
for(const id of ['c0','c1'])await mutual.prepare("INSERT INTO crmcalls_items(project,client_id,cycle,day,state,data) VALUES(?,?,'test','2026-11-20','pending','{}')").bind(project,id).run();
await mutual.prepare("INSERT INTO base_dispatch_items VALUES('sk','c0','pending')").run();
await mutual.prepare("UPDATE crmcalls_items SET state='sending' WHERE client_id='c0'").run();
assert.equal((await mutual.prepare("SELECT state FROM crmcalls_items WHERE client_id='c0'").first()).state,'pending');
await mutual.prepare("UPDATE crmcalls_items SET state='sending' WHERE client_id='c1'").run();
await mutual.prepare("INSERT INTO base_dispatch_items VALUES('sk','c1','pending')").run();
assert.equal((await mutual.prepare("SELECT COUNT(*) AS n FROM base_dispatch_items WHERE client_id='c1'").first()).n,0);mutual.close();
await assert.rejects(()=>crmcallsProjects(crmcallsApi('key',async()=>Response.json({data:[{id:project,name:'a',status:'draft'}],pagination:{total_pages:2}}))),/повторил/);
console.log('CRMCalls: fields, custom cycles, 5/2, exclusions, CAS, secret masking, verified import, no repeats, uncertain/partial/mismatched responses and rate limits passed');

// A cancelled order is refused in CRM; it must not exclude a free client.
const parity=await fixture();
await parity.prepare("INSERT INTO orders VALUES('cancelled','c0',?)").bind(JSON.stringify({status:'refused'})).run();
await parity.prepare("UPDATE clients SET data=json_set(data,'$.archived',1) WHERE id='c1'").run();
await initBaseDispatch(parity);
assert.deepEqual((await previewCRMCalls(parity,s,before)).rows.map(r=>r.id),['c0','c2','c3','c4']);
assert.deepEqual((await distributionCandidates(parity,'M','П','2026-11-20')).map(r=>r.id),['c0','c2','c3','c4']);
await saveCRMCallsSchedule(parity,s,'',before);
await assert.rejects(()=>queueBaseDispatch(parity,{base:'M',sheet:'П',project:'123',count:1},before),/CRMCalls/);
const pMock=mock();await runCRMCalls(parity,pMock.request,friday);await runCRMCalls(parity,pMock.request,friday);
assert.equal((await parity.prepare("SELECT COUNT(*) AS n FROM crmcalls_items WHERE state='sent'").first()).n,2);
await parity.prepare("INSERT INTO clients(id,phone,data) VALUES('a-new','79990000099',?)").bind(JSON.stringify({id:'a-new',phone:'79990000099',owner:'',sheet:'П',baseType:'M'})).run();
await runCRMCalls(parity,pMock.request,monday);await runCRMCalls(parity,pMock.request,monday);
assert.equal((await parity.prepare("SELECT state FROM crmcalls_items WHERE client_id='a-new'").first()).state,'sent','New clients enter the next daily portion without resaving settings');
parity.close();
const conflict=await fixture(),config=initialBaseSettings();Object.assign(config.M.sheets.find(v=>v.name==='П'),{automatic:true,projectId:'123'});
await conflict.prepare("UPDATE settings SET data=? WHERE id='base-settings'").bind(JSON.stringify({config})).run();
await assert.rejects(()=>saveCRMCallsSchedule(conflict,s,'',before),/выгрузка в СК/);conflict.close();
console.log('Shared SK/CRMCalls eligibility, refused orders, daily recalculation, oldest-first priority, common date and sheet exclusivity passed');

const resaved=await fixture(),rMock=mock();await saveCRMCallsSchedule(resaved,s,'',before);await runCRMCalls(resaved,rMock.request,friday);await runCRMCalls(resaved,rMock.request,friday);
const revision=(await crmcallsDashboard(resaved)).schedules[0].revision;
await saveCRMCallsSchedule(resaved,s,revision,friday);await runCRMCalls(resaved,rMock.request,new Date(friday.getTime()+60000));assert.equal(rMock.posts,1,'Resaving cannot reset the daily allowance');resaved.close();

// Saving after today's send time must honor the next-workday preview.
const future=await fixture(),fMock=mock();await saveCRMCallsSchedule(future,s,'',friday);await runCRMCalls(future,fMock.request,friday);assert.equal(fMock.posts,0);await runCRMCalls(future,fMock.request,monday);assert.equal(fMock.posts,1);future.close();

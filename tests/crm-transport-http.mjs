// Real HTTP streams against a temporary synthetic SQLite database; no external integrations.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {decodeCrmSnapshot} from '../lib/crm-state-delta.ts';
import {compactCrmState} from '../lib/compact-crm-state.ts';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-events-')),file=join(dir,'test.sqlite'),database=new DatabaseSync(file);
const origin='https://crm.test',port=process.env.EVENTS_TEST_PORT||'3109',base=`http://127.0.0.1:${port}`,password='synthetic-events-only-123';
let server,logs='';const streams=[];
try{
 database.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)database.exec(sql);
 const hash=await hashPassword(password);
 for(const id of ['one','two']){
  database.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role:'operator',department:'1',salary:0,bonus:0,version:1}));
  database.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);
 }
 database.prepare('INSERT INTO settings VALUES(?,?)').run('main','{"retentionDays":30}');
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_MAINTENANCE_WORKER:'1',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 for(let i=0;i<100;i++){try{await fetch(base+'/login');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal((await fetch(base+'/api/crm/changes')).status,401);
 const cookies=[];
 for(const login of ['one','two']){
  const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login,password})});
  assert.equal(r.status,200);cookies.push(r.headers.get('set-cookie').split(';')[0]);
 }

 const now=new Date().toISOString();
 for(let i=0;i<112;i++){
  const id='c-'+String(i).padStart(3,'0'),owner=i<61?'one':'two';
  const c={id,name:'Иван '+i,phone:'+7999'+String(i).padStart(7,'0'),city:'Москва',address:'Тест',source:'Fixture',owner,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:now,createdAt:now,version:1,legacyOrderHistory:[{externalId:'legacy-'+id,source:'LV',status:'paid',createdAt:now,amount:1,items:[]}],importFields:{private:'test'}};
  database.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(id,c.phone,JSON.stringify(c));
  const o={id:'o-'+id,clientId:id,manager:owner,logistic:'',status:'draft',items:[{name:'Test',quantity:1,price:1}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,version:1};
  database.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,id,JSON.stringify(o));
  for(let j=0;j<3;j++){const e={id:'e-'+id+'-'+j,clientId:id,orderId:o.id,at:now,actorId:owner,actor:owner,text:'History '+j};database.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(e.id,id,o.id,now,JSON.stringify(e));}
 }
 async function get(path,cookie=cookies[0],etag=''){
  const r=await fetch(base+path,{headers:{cookie,...(etag?{'If-None-Match':etag}:{})}});return {status:r.status,etag:r.headers.get('etag'),data:r.status===304?null:await r.json()};
 }
 const full=await get('/api/crm');assert.equal(full.status,200);
 database.prepare("INSERT INTO settings VALUES('crm-maintenance-health',?)").run(JSON.stringify({ok:true,at:now}));
 const first=await get('/api/crm?transport=compact-v1');assert.equal(first.status,200);
 assert.deepEqual(first.data,compactCrmState(full.data),'read-only compact projection preserves all non-history behavior');
 assert.equal(first.data.events.length,0);assert.ok(first.data.clients.every(c=>!c.legacyOrderHistory&&!c.importFields));
 const page0=await get('/api/crm?list=orders&view=orders&filter=all&page=0'),page1=await get('/api/crm?list=orders&view=orders&filter=all&page=1');
 assert.equal(page0.status,200);assert.equal(page0.data.total,61);assert.equal(page0.data.rows.length,50);assert.equal(page1.data.rows.length,11);assert.equal(new Set([...page0.data.rows,...page1.data.rows].map(o=>o.id)).size,61);
 assert.ok(page0.data.clients.every(c=>c.owner==='one'&&!c.legacyOrderHistory&&!c.importFields));
 assert.equal((await get('/api/crm?list=orders&view=orders&filter=all&page=-1')).status,400);
 assert.equal((await get('/api/crm?list=orders&view=orders&filter=all&query=o-c-060')).data.total,1);
 assert.equal((await get('/api/crm?list=mine&view=mine&filter=all&page=1')).data.clients.length,11);
 const history=await get('/api/crm/history?clientId=c-000');assert.equal(history.data.total,database.prepare("SELECT COUNT(*) AS n FROM events WHERE client_id='c-000'").get().n);
 assert.equal((await get('/api/crm/history?clientId=c-111')).data.total,0);
 assert.equal((await get('/api/crm/history?clientId=c-000&legacy=1')).data.total,1);
 assert.equal((await get('/api/crm?transport=compact-v1',cookies[0],first.etag)).status,304);
 const other=await get('/api/crm?transport=compact-v1',cookies[1],first.etag);assert.equal(other.status,200);assert.notEqual(other.data.kind,'crm-delta');assert.ok(other.data.clients.every(c=>c.owner==='two'));
 // Preserve 30 unrelated active reminders through a scoped mutation.
 for(let i=0;i<30;i++){const r={id:'keep-'+i,kind:'draft',clientId:'c-111',orderId:'o-c-111',title:'Keep',text:'',at:now,due:new Date(Date.parse(now)+86400000).toISOString()};database.prepare('INSERT INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?)').run('two',r.id,JSON.stringify(r),now);}
 const o=first.data.orders.find(o=>o.id==='o-c-000');
 const saved=await fetch(base+'/api/crm',{method:'POST',headers:{cookie:cookies[0],Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'updateOrder',addressConfirmed:true,id:o.id,version:o.version,items:o.items,newOrderComment:'Scoped save',responseMode:'entity-patch',transport:'compact-v1'})});
 const result=await saved.json();assert.equal(saved.status,200,JSON.stringify(result));assert.equal(result.entityPatch.clientId,'c-000');assert.equal(database.prepare("SELECT COUNT(*) AS n FROM reminders WHERE id LIKE 'keep-%'").get().n,30,'unrelated reminders must not be pruned by scoped save');
 assert.equal(JSON.parse(database.prepare("SELECT data FROM clients WHERE id='c-000'").get().data).legacyOrderHistory.length,1,'transport projection must not erase persisted history');
 const delta=await get('/api/crm?transport=compact-v1',cookies[0],first.etag);assert.equal(delta.data.kind,'crm-delta');
 assert.deepEqual(decodeCrmSnapshot(delta.data,first.data),(await get('/api/crm?transport=compact-v1')).data);
 assert.equal((await fetch(base+'/api/crm',{method:'POST',headers:{cookie:cookies[0],Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'updateOrder',addressConfirmed:true,id:o.id,version:o.version,items:o.items,responseMode:'entity-patch'})})).status,400,'stale versions still fail');
 // A failed/stale worker restores legacy maintenance; reads cannot leave expired rules frozen.
 database.prepare("UPDATE orders SET data=json_set(data,'$.createdAt','2020-01-01T00:00:00Z','$.draftHours',1),version=version+1 WHERE id='o-c-001'").run();
 await get('/api/crm?transport=compact-v1');assert.equal(JSON.parse(database.prepare("SELECT data FROM orders WHERE id='o-c-001'").get().data).status,'draft');
 database.prepare("UPDATE settings SET data=? WHERE id='crm-maintenance-health'").run(JSON.stringify({ok:false,at:now}));
 await get('/api/crm?transport=compact-v1');assert.equal(JSON.parse(database.prepare("SELECT data FROM orders WHERE id='o-c-001'").get().data).status,'refused');
 console.log('HTTP transport: compact/full parity, role scopes, server pages/search, remote history, deltas, bounded save, reminders, version conflicts and worker fallback passed');
}catch(error){console.error(logs);throw error;}finally{
 if(server){server.kill();await once(server,'exit');}database.close();rmSync(dir,{recursive:true,force:true});
}

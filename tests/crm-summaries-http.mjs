// Synthetic local standalone integration: never connects to CRM or telephone providers.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-summaries-http-')),file=join(dir,'test.sqlite'),d=new DatabaseSync(file);
const port=process.env.SUMMARIES_TEST_PORT||'3133',base=`http://127.0.0.1:${port}`,cookies=[];let server,worker,logs='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stop=async p=>{if(p&&p.exitCode===null){p.kill();await once(p,'exit');}};
const env={...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_MAINTENANCE_WORKER:'1',CRM_ORIGIN:base,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:port};
const child=(args,extra={})=>{const p=spawn(process.execPath,args,{env:{...env,...extra},stdio:['ignore','pipe','pipe']});p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);return p;};
const read=(part,i=0)=>fetch(base+'/api/crm'+part,{headers:{cookie:cookies[i]}});
const json=async(part,i=0)=>{const r=await read(part,i);return {status:r.status,body:await r.json()};};
async function start(flag){server=child([resolve('.next/standalone/server.js')],{CRM_SUMMARIES_WORKER:flag});for(let i=0;i<200;i++){try{if((await fetch(base+'/login')).ok)return;}catch{}await pause(100);}throw Error('standalone startup timeout');}
async function ready(afterComputedAt=0){for(let i=0;i<150;i++){const r=await json('?part=summary');if(r.body.status==='ready'&&Date.parse(r.body.computedAt)>afterComputedAt)return r.body;await pause(100);}throw Error('prepared summary timeout');}
try{
 d.exec('PRAGMA journal_mode=WAL');d.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)d.exec(sql);
 const now=new Date().toISOString();
 for(let i=0;i<2;i++){
  const id='operator-'+i,token=randomBytes(32).toString('hex');cookies.push('__Host-sm-session='+token);
  d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:id,role:'operator',department:String(i+1),salary:0,bonus:0}));
  d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,'synthetic');d.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
  const c={id:'c-'+i,name:'Synthetic '+i,phone:'+7999000000'+i,owner:id,city:'Москва',address:'',source:'Fixture',createdAt:now,assignedUntil:''};
  d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
  const o={id:'o-'+i,clientId:c.id,manager:id,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now};
  d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 d.prepare("UPDATE orders SET data=json_set(data,'$.status','redeemed','$.delivery','russian_post','$.paymentReceivedAt',?,'$.paymentReceipt.amount',1000) WHERE id='o-1'").run(new Date().toISOString());
 await start('0');assert.equal((await json('?part=bootstrap')).body.preparedSummaries,false);assert.equal((await json('?part=context')).status,200);assert.equal((await json('?part=summary')).status,403);await stop(server);
 await start('1');assert.equal((await json('?part=bootstrap')).body.preparedSummaries,true);
 const missing=await json('?part=context');assert.equal(missing.status,503);assert.equal(missing.body.clients,undefined);assert.ok(['pending','error'].includes(missing.body.readModel.status));
 assert.equal((await json('?part=summary')).body.data,undefined);
 const list=await json('?list=mine&view=mine&filter=all&clientWorkFilter=all');assert.equal(list.status,200);assert.equal(list.body.clients[0].id,'c-0');assert.equal(list.body.workCounts.all,1);assert.ok(list.body.financialReadModel);
 const run=child(['--experimental-strip-types',resolve('scripts/sync-summaries.mjs'),'--once'],{CRM_SUMMARIES_WORKER:'1'});assert.equal((await once(run,'exit'))[0],0);
 const onceSummary=d.prepare("SELECT computed_at FROM crm_read_models WHERE kind='summary' AND scope='operator-0'").get();assert.ok(onceSummary);
 // A stopped worker explicitly marks its persisted output stale, never ready/zero.
 assert.equal((await json('?part=summary')).body.status,'stale');
 worker=child(['--experimental-strip-types',resolve('scripts/sync-summaries.mjs')],{CRM_SUMMARIES_WORKER:'1'});
 // Claiming the lease makes still-fresh --once output ready before the new daemon's
 // cache is warm. Wait for its own scope publication before testing cache reuse.
 const summary=await ready(onceSummary.computed_at);assert.equal(summary.data.mine.all,1);assert.equal(summary.data.work.all,1);assert.equal(typeof summary.data.listRevision,'string');
 const context=await json('?part=context');assert.equal(context.status,200);assert.equal(context.body.readModel.status,'ready');assert.deepEqual(context.body.clients.map(c=>c.id),['c-0']);assert.equal(context.body.financialReadModel.status,'ready');
 const previousFinance=context.body.financialReadModel.sourceRevision;
 const previousContextJson=d.prepare("SELECT data FROM crm_read_models WHERE kind='context' AND scope='operator-0'").get().data;
 d.prepare("UPDATE orders SET data=json_set(data,'$.paymentReceipt.amount',1100),version=version+1 WHERE id='o-1'").run();
 await ready();
 const refreshed=await json('?part=context');assert.equal(refreshed.status,200);assert.equal(refreshed.body.readModel.status,'ready');assert.equal(refreshed.body.financialReadModel.status,'ready');assert.notEqual(refreshed.body.financialReadModel.sourceRevision,previousFinance);
 assert.equal(d.prepare("SELECT data FROM crm_read_models WHERE kind='context' AND scope='operator-0'").get().data,previousContextJson,'unchanged context need not rewrite its large JSON when unrelated finance changes');
 assert.equal((await json('?part=card&type=client&id=c-1')).status,404);
 await stop(worker);worker=undefined;
 d.prepare("UPDATE orders SET data=json_set(data,'$.comment','saved'),version=version+1 WHERE id='o-0'").run();
 const stale=await json('?part=summary');assert.equal(stale.body.status,'stale');assert.equal(stale.body.data.mine.all,1);
 // Deliberately invalid calculation input proves HTTP never falls back to enrichment.
 d.prepare("INSERT INTO settings(id,data) VALUES('base-settings','{}') ON CONFLICT(id) DO UPDATE SET data='{}'").run();
 assert.equal((await json('?part=context')).status,200);assert.equal((await json('?part=context',1)).status,503);
 d.prepare("UPDATE clients SET data=json_set(data,'$.owner','operator-1'),version=version+1 WHERE id='c-0'").run();
 const revoked=await json('?part=context');assert.equal(revoked.status,503);assert.equal(revoked.body.clients,undefined);assert.equal((await json('?part=summary')).body.data,undefined);
 d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='operator-0'").run();assert.equal((await read('?part=summary')).status,401);
 console.log(JSON.stringify({synthetic:true,legacy:true,missing503:true,persistentOnce:true,ready:true,stale:true,scopeIsolation:true,accessFence:true,noHeavyHttpFallback:true}));
}catch(error){console.error(logs);throw error;}finally{await stop(worker);await stop(server);d.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-summaries-http-'));rmSync(dir,{recursive:true,force:true});}

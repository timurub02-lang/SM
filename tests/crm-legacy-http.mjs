// Two real Next processes, synthetic shared SQLite and a loopback relay that can revoke
// rights between primary authentication and worker authentication. No provider calls.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {decodeCrmSnapshot} from '../lib/crm-state-delta.ts';

const output=process.env.LEGACY_TEST_OUTPUT;if(output)mkdirSync(output,{recursive:true});
const dir=mkdtempSync(join(output||tmpdir(),'crm-legacy-http-')),file=join(dir,'synthetic.sqlite'),d=new DatabaseSync(file);
const runtime=resolve(process.env.STANDALONE_RUNTIME||process.env.LEGACY_TEST_RUNTIME||'.next/standalone/server.js');
const port=Number(process.env.LEGACY_TEST_PORT||3150),workerPort=port+1;
const base=`http://127.0.0.1:${port}`,workerBase=`http://127.0.0.1:${workerPort}`;
const cookies=new Map(),checks=[];let primary,worker,relay,intercept,forwarded=0,logs='',passed=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stop=async p=>{if(p&&p.exitCode===null){p.kill();await once(p,'exit');}};
const env={...process.env,CRM_RUNTIME:'miran',CRM_SPLIT_READS:'1',CRM_SUMMARIES_WORKER:'0',CRM_MAINTENANCE_WORKER:'1',CRM_ORIGIN:base,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',TEMP:dir,TMP:dir,TMPDIR:dir};
async function start(isWorker){
 const child=spawn(process.execPath,[runtime],{env:{...env,PORT:String(isWorker?workerPort:port),CRM_LEGACY_SNAPSHOT_WORKER:isWorker?'1':'0',CRM_LEGACY_SNAPSHOT_ORIGIN:isWorker?'':`http://127.0.0.1:${relay.address().port}`},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 if(isWorker)worker=child;else primary=child;
 for(let i=0;i<200;i++){
  if(child.exitCode!==null)throw Error('Next process exited before ready');
  try{if((await fetch((isWorker?workerBase:base)+(isWorker?'/api/crm-worker-health':'/login'))).ok)return;}catch{}
  await pause(100);
 }
 throw Error('Next startup timeout');
}
async function call(id,path='?transport=compact-v1',options={},origin=base){
 const response=await fetch(origin+(path.startsWith('/')?path:'/api/crm'+path),{redirect:'manual',...options,headers:{cookie:cookies.get(id)||'',...options.headers},signal:AbortSignal.timeout(45000)});
 const text=await response.text();let data;try{data=JSON.parse(text);}catch{}
 return {status:response.status,headers:response.headers,text,data};
}
function heartbeat(){d.prepare("INSERT INTO settings(id,data) VALUES('crm-maintenance-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify({ok:true,at:new Date().toISOString()}));}
try{
 d.exec('PRAGMA journal_mode=WAL');d.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)d.exec(sql);
 const now=new Date().toISOString(),roles=['admin','logistic','chief_logistic','redemption','courier','operator','department_head'];
 for(const role of roles){
  const e={id:role,login:role,name:'Synthetic '+role,role,department:'one',salary:700,bonus:31},token=randomBytes(32).toString('hex');
  d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,'synthetic-only');d.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),e.id,Date.now()+3600000);cookies.set(e.id,'__Host-sm-session='+token);
 }
 d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();heartbeat();
 const c={id:'client',name:'Synthetic client',phone:'+79990000001',linkedPhones:['+79990000002'],city:'Москва',address:'Synthetic',source:'Fixture',owner:'operator',createdAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString()};
 d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
 const order={id:'shared',clientId:c.id,manager:'operator',logistic:'logistic',status:'shipping',delivery:'moscow_courier',courier:{id:'courier',name:'Synthetic courier',phase:'accepted',assignedAt:now,amount:100},paymentReceipt:{amount:100,receivedByName:'Synthetic finance'},paymentReceivedBy:'admin',items:[],comment:'before',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now};
 for(const o of [order,{...order,id:'secret',zvd:true},{...order,id:'draft',status:'draft',delivery:undefined,courier:undefined,paymentReceipt:undefined}])d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 relay=createServer((req,res)=>{
  forwarded++;if(intercept){const change=intercept;intercept=undefined;change();}
  const upstream=httpRequest(workerBase+req.url,{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
  upstream.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Synthetic worker stopped"}');});req.pipe(upstream);
 });relay.listen(0,'127.0.0.1');await once(relay,'listening');await start(true);await start(false);
 for(const role of roles.slice(0,5)){
  heartbeat();
  // Unknown diagnostic query bypasses the strict proxy allowlist and exercises the
  // unchanged primary handler against the same DB as the worker, not a copied model.
  const direct=await call(role,'?transport=compact-v1&comparison=direct');assert.equal(direct.status,200,direct.text);
  const before=forwarded,full=await call(role);assert.equal(full.status,200,full.text);assert.equal(forwarded,before+1);assert.deepEqual(full.data,direct.data,role+' worker/main field and permission parity');
  assert.equal(full.data.orders.some(o=>o.id==='secret'),role==='admin','ZVD visibility preserved');
  const shared=full.data.orders.find(o=>o.id==='shared');assert.ok(shared);
  if(role==='courier'){assert.equal(shared.manager,'');assert.equal(shared.paymentReceipt,undefined);assert.deepEqual(full.data.employees.map(e=>e.id),['courier']);}
  if(role==='redemption'){assert.equal(shared.paymentReceipt,undefined);assert.equal(shared.paymentReceivedAmount,100);}
  if(role!=='admin'&&role!=='courier')assert.equal(full.data.employees.find(e=>e.id==='operator').salary,0);
  const etag=full.headers.get('etag');assert.ok(etag);const unchanged=await call(role,'?transport=compact-v1',{headers:{'If-None-Match':etag}});assert.equal(unchanged.status,304,unchanged.text);assert.equal(unchanged.text,'');
  d.prepare("UPDATE orders SET data=json_set(data,'$.comment',?),version=version+1 WHERE id='shared'").run('updated '+role);
  const delta=await call(role,'?transport=compact-v1',{headers:{'If-None-Match':etag}});assert.equal(delta.status,200,delta.text);assert.equal(delta.data.kind,'crm-delta');
  const decoded=decodeCrmSnapshot(delta.data,full.data),fresh=await call(role,'?transport=compact-v1&comparison=direct');assert.deepEqual(decoded,fresh.data);assert.equal(decoded.orders.find(o=>o.id==='shared').comment,'updated '+role);
  checks.push(role+': exact full parity, masks, 304 and decoded delta');
 }
 for(const role of ['operator','department_head']){
  const before=forwarded,read=await call(role,'?part=bootstrap');assert.equal(read.status,200,read.text);assert.equal(read.data.splitReads,true);
  const list=await call(role,'?list=orders&view=orders&filter=all');assert.equal(list.status,200,list.text);assert.equal(forwarded,before);
  const denied=await call(role,'?transport=compact-v1',{},workerBase);assert.equal(denied.status,403);
 }
 assert.equal((await call('', '?transport=compact-v1',{},workerBase)).status,401);
 for(const path of ['/api/crm?transport=compact-v1','/api/sk-order-events','/api/auth/login'])assert.equal((await call('admin',path,{method:'POST',body:'{}',headers:{Origin:base,'Content-Type':'application/json'}},workerBase)).status,403);
 assert.equal((await call('admin','/api/warehouse',{},workerBase)).status,403);
 checks.push('operator/head bypass; worker unauthenticated and mutation/integration routes rejected');
 intercept=()=>d.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='admin'").run();const revoked=await call('admin');assert.equal(revoked.status,401,revoked.text);assert.equal(revoked.data.orders,undefined);d.prepare("UPDATE auth_accounts SET enabled=1 WHERE employee_id='admin'").run();
 intercept=()=>d.prepare("UPDATE employees SET data=json_set(data,'$.role','operator'),version=version+1 WHERE id='admin'").run();const downgraded=await call('admin');assert.equal(downgraded.status,403,downgraded.text);assert.equal(downgraded.data.orders,undefined);d.prepare("UPDATE employees SET data=json_set(data,'$.role','admin'),version=version+1 WHERE id='admin'").run();
 checks.push('account disabled and role downgraded after primary auth rejected by fresh worker auth');
 await stop(worker);worker=undefined;assert.equal((await call('admin')).status,503);
 const before=forwarded,op=await call('operator','?list=orders&view=orders&filter=all');assert.equal(op.status,200,op.text);
 const version=d.prepare("SELECT version FROM orders WHERE id='draft'").get().version;
 const saved=await call('operator','/api/crm',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'comment',id:'draft',version,text:'Synthetic save with worker stopped',responseMode:'entity-patch-v2'})});assert.equal(saved.status,200,saved.text);assert.ok(saved.data.entityPatch);assert.equal(d.prepare("SELECT version FROM orders WHERE id='draft'").get().version,version+1);assert.equal(forwarded,before);
 checks.push('worker down: legacy 503; operator list and actual CAS save succeed locally');passed=true;
 console.log(JSON.stringify({synthetic:true,passed,checks}));
}catch(error){if(!output)console.error(logs);throw error;}finally{
 await stop(worker);await stop(primary);if(relay){relay.closeAllConnections();await new Promise(r=>relay.close(r));}d.close();
 if(output){writeFileSync(join(output,'result.json'),JSON.stringify({synthetic:true,passed,runtime,buildId:readFileSync(join(dirname(runtime),'.next/BUILD_ID'),'utf8').trim(),checks},null,2));writeFileSync(join(output,'runtime.log'),logs);}
 else{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-legacy-http-'));rmSync(dir,{recursive:true,force:true});}
}

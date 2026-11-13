// Two real web processes share only a synthetic SQLite file and authenticated sessions.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
const dir=mkdtempSync(join(tmpdir(),'crm-slots-')),file=join(dir,'synthetic.sqlite'),db=new DatabaseSync(file);
const origin='https://crm.test',port=Number(process.env.SLOTS_TEST_PORT||3170),bases=[0,1].map(i=>`http://127.0.0.1:${port+i}`),children=[],streams=[];
const runtime=resolve(process.env.STANDALONE_RUNTIME||'.next/standalone/server.js');let logs='';
const token=randomBytes(32).toString('hex'),cookie='__Host-sm-session='+token;
async function call(slot,path,body){
 const response=await fetch(bases[slot]+path,{method:body?'POST':'GET',headers:{cookie,...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;
}
async function stream(slot,cursor=''){
 const controller=new AbortController();streams.push(controller);
 const response=await fetch(bases[slot]+'/api/crm/changes',{headers:{cookie,...(cursor?{'Last-Event-ID':cursor}:{})},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});assert.equal(response.status,200);
 const reader=response.body.getReader();let buffer='';
 return {controller,async next(){for(;;){const {value,done}=await reader.read();assert.ok(!done);buffer+=new TextDecoder().decode(value);let cut;while((cut=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);if(frame.includes('event: change'))return /id: (.+)/.exec(frame)[1];}}}};
}
try{
 db.exec('PRAGMA journal_mode=WAL');db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)db.exec(sql);
 const employee={id:'one',login:'one',name:'Synthetic operator',role:'operator',department:'one',salary:0,bonus:0,version:1};
 db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(employee.id,JSON.stringify(employee));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run('one','synthetic-unused');db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'one',Date.now()+3600000);
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main','{"retentionDays":30}');
 const now=new Date().toISOString();
 for(let i=0;i<33;i++){
  const c={id:'c-'+i,name:'Synthetic',phone:'+7999'+String(i).padStart(7,'0'),city:'Москва',address:'Fixture',source:'Fixture',owner:'one',createdAt:now,assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:now,version:1};
  const o={id:'o-'+i,clientId:c.id,manager:'one',logistic:'',status:'draft',items:[{name:'Fixture',quantity:1,price:1}],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:now,updatedAt:now,version:1};
  db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(o.id,c.id,JSON.stringify(o));
 }
 for(let slot=0;slot<2;slot++){
  const child=spawn(process.execPath,[runtime],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,CRM_MAINTENANCE_WORKER:'1',CRM_SUMMARIES_WORKER:'0',CRM_SPLIT_READS:'1',CRM_LEGACY_SNAPSHOT_ORIGIN:'',CRM_LEGACY_SNAPSHOT_WORKER:'0',HOSTNAME:'127.0.0.1',PORT:String(port+slot)},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(bases[slot]+'/login')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  await call(slot,'/api/crm?part=tasks');
 }
 const draft=await call(0,'/api/crm?part=card&type=order&id=o-0');const order=draft.orders[0];
 const first=await stream(0),cursor=await first.next();
 const save=(slot,o)=>call(slot,'/api/crm',{action:'updateOrder',addressConfirmed:true,id:o.id,version:o.version,items:o.items,newOrderComment:'Saved across slots',responseMode:'entity-patch',transport:'compact-v1'});
 await save(1,order);assert.notEqual(await first.next(),cursor);first.controller.abort();
 const next=await stream(1,cursor);assert.notEqual(await next.next(),cursor);next.controller.abort();
 for(let start=1;start<33;start+=4)await Promise.all(Array.from({length:4},(_,j)=>{const i=start+j;return save(i%2,{id:'o-'+i,version:1,items:order.items});}));
 assert.equal(db.prepare("SELECT count(*) n FROM orders WHERE version=2").get().n,33);
 for(let slot=0;slot<2;slot++){
  const result=await call(slot,'/api/crm?part=card&type=order&id=o-0');assert.equal(result.orders[0].version,2);
 }
 db.prepare("UPDATE auth_accounts SET enabled=0 WHERE employee_id='one'").run();
 for(const base of bases)assert.equal((await fetch(base+'/api/crm/changes',{headers:{cookie}})).status,401);
 console.log('Two real web slots: shared sessions, old-form save, 33 exactly-once writes, cross-slot SSE/reconnect and revocation passed');
}catch(error){console.error(logs);throw error;}finally{
 streams.forEach(s=>s.abort());await Promise.all(children.map(async child=>{if(child.exitCode===null){child.kill();await once(child,'exit');}}));db.close();rmSync(dir,{recursive:true,force:true});
}

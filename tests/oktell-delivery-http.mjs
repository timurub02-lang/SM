import {controlSocket} from './fixtures/control-socket.mjs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
const ui=process.argv.includes('--ui'),dev=ui||process.argv.includes('--dev');
const dir=mkdtempSync(join(tmpdir(),'oktell-delivery-')),file=join(dir,'fixture.sqlite'),d=new DatabaseSync(file);
const base='http://127.0.0.1:3341',origin=base,taskId='10000000-0000-4000-8000-000000000001';
const sock=process.platform==='win32'?'\\\\.\\pipe\\oktell-delivery-'+crypto.randomUUID():controlSocket(join(dir,'bridge.sock'));
const receipts=new Map(),requests=[];let loseReply=false,server,logs='';
const bridge=http.createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{
 requests.push(req.url);res.setHeader('Content-Type','application/json');assert.equal(req.url,'/delivery');
 if(req.method==='GET'){res.end(JSON.stringify({taskId,sourcePresent:true,sourceAttached:false,paused:true,contacts:[...receipts.values()].filter(r=>!r.cancelled).reduce((n,r)=>n+r.accepted,0),sessions:0}));return;}
 const b=JSON.parse(raw);assert.equal(b.taskId,taskId);
 if(b.action==='import'){if(!receipts.has(b.id))receipts.set(b.id,{id:b.id,taskId,fingerprint:b.fingerprint,accepted:b.items.length,cancelled:false});if(loseReply){loseReply=false;res.writeHead(503).end(JSON.stringify({error:'Synthetic lost reply'}));return;}}
 else{assert.equal(b.action,'cancel');receipts.get(b.id).cancelled=true;}
 res.end(JSON.stringify(receipts.get(b.id)));
 });});
async function call(path,cookie,body,from=origin){const r=await fetch(base+path,{redirect:'manual',method:body?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(body?{Origin:from,'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:await r.json()};}
async function cleanup(){if(server&&server.exitCode===null){if(dev&&process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});else{const ended=once(server,'exit');server.kill();await ended;}}await new Promise(r=>bridge.close(r));d.close();rmSync(dir,{recursive:true,force:true});}
try{
 d.exec(readFileSync('drizzle/0000_cynical_monster_badoon.sql','utf8'));for(const sql of authSchema)d.exec(sql);
 const password='synthetic-delivery-only-2026',hash=await hashPassword(password);
 for(const [id,role] of [['admin','admin'],['operator','operator']]){d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(id,JSON.stringify({id,login:id,name:role==='admin'?'Тестовый администратор':'Тестовый оператор',role,department:'1',salary:0,bonus:0,skLogin:''}));d.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(id,hash);}
 d.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));
 const config=initialBaseSettings();config.dispatchTarget='oktell';d.prepare('INSERT INTO settings VALUES(?,?)').run('base-settings',JSON.stringify({config,revision:crypto.randomUUID()}));
 for(let i=1;i<=6;i++){const c={id:'C-fixture-'+i,name:'Тестовый клиент '+i,phone:i===6?'invalid':'7999000000'+i,owner:i===4?'operator':'',sheet:i===5?'ЧС':'Т1',baseType:'M',source:'Синтетический стенд',createdAt:new Date().toISOString(),city:'',address:''};d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));}
 await new Promise(r=>bridge.listen(sock,r));
 const args=dev?[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3341']:[resolve('.next/standalone/server.js')];
 server=spawn(process.execPath,args,{env:{...process.env,CRM_RUNTIME:'miran',OKTELL_CONTROL_SOCKET:sock,CRM_ORIGIN:origin,CRM_DATABASE_PATH:file,HOSTNAME:'127.0.0.1',PORT:'3341'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 let ready=false;for(let i=0;i<180;i++){try{if((await fetch(base+'/login')).status===200){ready=true;break;}}catch{}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));}assert.ok(ready,'Local fixture did not start');
 if(ui){console.log('SYNTHETIC UI READY '+base+' — login admin / '+password);await new Promise(resolve=>{process.stdin.resume();process.stdin.once('data',resolve);});}
 else{
  const admin=await call('/api/auth/login',null,{login:'admin',password}),operator=await call('/api/auth/login',null,{login:'operator',password});assert.equal(admin.status,200);assert.equal(operator.status,200);
  const cookie=admin.headers.get('set-cookie').split(';')[0],operatorCookie=operator.headers.get('set-cookie').split(';')[0],selection={base:'M',sheet:'Т1',count:2,taskId};
  assert.equal((await call('/api/oktell-delivery')).status,403);
  assert.equal((await call('/api/oktell-delivery',operatorCookie,{action:'preview',selection})).status,403);
  assert.equal((await call('/api/oktell-delivery',cookie,{action:'preview',selection},'https://foreign.test')).status,403);assert.equal(requests.length,0);
  assert.equal((await call('/api/oktell-delivery',cookie,{action:'start'})).status,400);
  const preview=await call('/api/oktell-delivery',cookie,{action:'preview',selection});assert.equal(preview.status,200);assert.equal(preview.data.selected,2);assert.equal(preview.data.items,undefined);
  const id=crypto.randomUUID(),upload={action:'upload',selection,id,fingerprint:preview.data.fingerprint};loseReply=true;
  assert.equal((await call('/api/oktell-delivery',cookie,upload)).status,409);
  assert.equal((await call('/api/oktell-delivery',cookie,{action:'retry',id})).data.state,'delivered');assert.equal(receipts.size,1);
  assert.equal((await call('/api/oktell-delivery',cookie,upload)).data.state,'delivered');assert.equal(receipts.size,1);
  assert.equal((await call('/api/oktell-delivery',cookie,{action:'cancel',id})).data.state,'cancelled');
  const history=await call('/api/oktell-delivery',cookie);assert.equal(history.data.jobs[0].state,'cancelled');assert.equal(history.data.source.contacts,0);
  const session=crypto.randomUUID(),revision=JSON.parse(d.prepare("SELECT data FROM settings WHERE id='base-settings'").get().data).revision;
  const original=JSON.parse(d.prepare("SELECT data FROM clients WHERE id='C-fixture-4'").get().data);
  const importBody={action:'import',base:'M',filename:'synthetic.xlsx',session,offset:0,revision,copyFields:true,rows:[
   {row:2,phone:'79990000001',name:'File name',fields:{Город:'Тест',ДАТА:'2026-01-02','Круг 1 — партия':'4'}},
   {row:3,phone:'79990000004',name:'Must not overwrite',fields:{'Круг 1 — заказы':'2'}},
   {row:4,phone:'79990000007',name:'New file client',fields:{ДАТА:'2026-02-03'}}]};
  assert.equal((await call('/api/base?actorId=admin',cookie,{...importBody,apply:false})).data.applied,false);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM base_import_members').get().n,0);
  const imported=await call('/api/base?actorId=admin',cookie,{...importBody,apply:true});assert.equal(imported.status,200);assert.equal(imported.data.fieldsUpdated,2);assert.equal(imported.data.added,1);
  assert.equal((await call('/api/base?actorId=admin',cookie,{...importBody,apply:true})).data.applied,true);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM base_import_members').get().n,3);
  const changed=JSON.parse(d.prepare("SELECT data FROM clients WHERE id='C-fixture-4'").get().data);
  assert.equal(changed.owner,original.owner);assert.equal(changed.name,original.name);assert.equal(changed.importFields['Круг 1 — заказы'],'2');
  const scoped=await call('/api/oktell-delivery',cookie,{action:'preview',selection:{...selection,count:100,importSession:session}});
  assert.equal(scoped.status,200);assert.equal(scoped.data.total,3);assert.equal(scoped.data.selected,2);assert.equal(scoped.data.skipped.assigned,1);
  assert.equal((await call('/api/oktell-delivery',cookie,{action:'preview',selection:{...selection,importSession:crypto.randomUUID()}})).status,409);
  assert.equal((await call('/api/oktell-delivery',cookie)).data.imports[0].total,3);
  assert.ok(requests.every(p=>p==='/delivery'));console.log('PASS: admin-only delivery HTTP, origin checks, bounded preview, durable uncertain upload, replay and confirmed cancellation; no calls');
 }
}catch(e){console.error(logs.slice(-5000));throw e;}finally{await cleanup();}

// Isolated database and fake Oktell control socket. Never contacts an actual PBX.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const dir=mkdtempSync(join(tmpdir(),'oktell-browser-test-')),db=new DatabaseSync(join(dir,'test.sqlite'));
const id='E-43a21d76-351',port=process.env.PREVIEW?'3337':'3097',origin=process.env.PREVIEW?'http://127.0.0.1:3337':'https://crm.test',base=`http://127.0.0.1:${port}`,socket=join(dir,'control.sock');
let server,logs='',owner='',call=null,connected=false;const commands=[],leases=new Map();
const bridge=http.createServer(async(req,res)=>{let body='';for await(const x of req)body+=x;res.setHeader('Content-Type','application/json');if(req.url.startsWith('/operator')){res.end(JSON.stringify({state:'offline',checkedAt:new Date().toISOString(),hasLine:false,busy:false,login:'preview'}));return;}if(!body){const actor=new URL(req.url,'http://localhost').searchParams.get('actor');res.end(JSON.stringify({connected:true,prepared:!!leases.get(actor)?.connected,registered:!!leases.get(actor)?.connected}));return;}const b=JSON.parse(body);({owner='',connected=false}=leases.get(b.actor)||{});commands.push(b);if(owner&&owner!==b.owner){res.writeHead(409).end(JSON.stringify({error:'Телефон уже подключён в другой вкладке'}));return;}if(b.action==='connect'){owner=b.owner;connected=true;}if(b.action==='disconnect'){owner='';connected=false;}leases.set(b.actor,{owner,connected});if(b.action==='authorize')assert.match(b.destination,/^7\d{10}$/);res.end(JSON.stringify({username:'fixture',authorizationUsername:'fixture',password:'fixture',domain:'example.invalid',token:'fixture',connected:true,prepared:connected,registered:connected,call}));});
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword('synthetic-browser-preview-2026');
 for(const [who,role] of [[id,'operator'],['other','operator'],['admin','admin'],['E-second','operator']]){db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(who,JSON.stringify({id:who,login:who===id?'irina':who,name:who===id?'Ирина · проверка интерфейса':who,alias:'',skLogin:'',role,department:'1',salary:0,bonus:0,oktell:(who===id||who==='E-second')?{requested:true,status:'linked',userId:'00000000-0000-4000-8000-000000000001',login:'fixture'}:undefined}));db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(who,hash);}
 db.prepare('INSERT INTO settings VALUES(?,?)').run('main',JSON.stringify({retentionDays:30}));db.prepare('INSERT INTO settings VALUES(?,?)').run('oktell-browser-test',JSON.stringify({clientId:'test-card'}));
 const c={id:'test-card',name:'Тест связи Oktell',phone:'+79990000007',city:'',address:'',source:'Тест Oktell',owner:id,baseType:'M',sheet:'К',assignedUntil:new Date(Date.now()+86400000).toISOString(),assignmentStartedAt:new Date().toISOString(),trialUntil:new Date(Date.now()+86400000).toISOString(),createdAt:new Date().toISOString(),version:1};db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(c.id,c.phone,JSON.stringify(c));
 await new Promise(r=>bridge.listen(socket,r));
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_PHONE_STAFF_ENABLED:'1',CRM_PHONE_RESULT_KEY:'synthetic-fixture-result-key-32-characters-only',CRM_PHONE_CALLER_ID:'79000000000',CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:join(dir,'test.sqlite'),OKTELL_CONTROL_SOCKET:socket,HOSTNAME:process.env.PREVIEW?'10.20.0.10':'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 const address=process.env.PREVIEW?'http://10.20.0.10:'+port:base;
 let ready=false;for(let i=0;i<150;i++){try{await fetch(address+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,logs);
 async function req(path,body,cookie='',extra={}){const r=await fetch(address+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const cookies={};for(const who of ['irina','other','admin','E-second']){const r=await req('/api/auth/login',{login:who,password:'synthetic-browser-preview-2026'});assert.equal(r.status,200);cookies[who]=r.cookie;}
 const closeCalls=()=>db.prepare("UPDATE phone_calls SET status='cancelled',ended_at=? WHERE ended_at IS NULL").run(new Date().toISOString());
 const tab=crypto.randomUUID();
 assert.equal((await req('/api/oktell-phone')).status,403);
 assert.equal((await req('/api/oktell-pilot',{action:'sync'},'')).status,403);
 assert.equal((await req('/api/oktell-pilot',{action:'sync'},cookies.admin)).status,403);
 assert.equal((await req('/api/oktell-pilot',{action:'sync'},cookies.irina,{Origin:'https://evil.invalid'})).status,403);
 for(const who of ['other','admin'])assert.equal((await req('/api/oktell-phone',null,cookies[who])).status,403);
 assert.equal((await req('/api/oktell-phone',{action:'connect',tab},cookies.irina,{Origin:'https://evil.invalid'})).status,403);assert.equal(commands.length,0);
 assert.equal((await req('/api/oktell-phone',{action:'connect',tab},cookies.irina)).status,200);
 assert.equal((await req('/api/oktell-phone',{action:'connect',tab:crypto.randomUUID()},cookies.irina)).status,409);
 const secondTab=crypto.randomUUID();
 assert.equal((await req('/api/oktell-phone',{action:'connect',tab:secondTab},cookies['E-second'])).status,200);
 assert.equal(commands.at(-1).actor,'E-second');
 assert.equal((await req('/api/oktell-phone',{action:'disconnect',tab:secondTab},cookies['E-second'])).status,200);
 assert.equal((await req('/api/oktell-phone',null,cookies.irina)).data.prepared,true);
 assert.equal((await req('/api/oktell-phone',null,cookies['E-second'])).data.prepared,false);
 assert.equal((await req('/api/oktell-phone',{action:'heartbeat',tab:secondTab,actor:id},cookies['E-second'])).status,400);
 db.prepare("UPDATE employees SET data=json_set(data,'$.oktell.status','pending') WHERE id=?").run('E-second');
 assert.equal((await req('/api/oktell-phone',null,cookies['E-second'])).status,403);
 function addCard(clientId,phone,owner=id){const card={...c,id:clientId,phone,owner,name:'Synthetic '+clientId,linkedPhones:clientId==='new-card'?['+79990000002']:[]};db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').run(clientId,phone,JSON.stringify(card));}
 addCard('existing-card','8 (999) 000-00-01');addCard('foreign-card','+79990000003','other');
 for(const clientId of ['test-card','existing-card']){
  const mts=await req('/api/oktell-phone',{action:'call',tab,clientId},cookies.irina);assert.equal(mts.status,200,JSON.stringify(mts.data));assert.equal(mts.data.destination,clientId==='test-card'?'79990000007':'79990000001');
  assert.equal(commands.at(-1).destination,mts.data.destination);
  assert.equal((await req('/api/telephony',{mode:'client',clientId},cookies.irina)).status,400);closeCalls();
  const beeline=await req('/api/telephony',{mode:'client',clientId},cookies.irina);assert.equal(beeline.status,200,JSON.stringify(beeline.data));assert.equal(db.prepare('SELECT destination FROM phone_call_targets WHERE call_id=?').get(beeline.data.callId).destination,mts.data.destination);
  assert.notEqual((await req('/api/oktell-phone',{action:'call',tab,clientId},cookies.irina)).status,200);closeCalls();
 }
 // Order calls retain order history and enforce the same access rules.
 for(const [orderId,clientId,manager] of [['own-order','existing-card',id],['foreign-order','foreign-card','other']]){
  const o={id:orderId,clientId,manager,logistic:'',status:'draft',items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt:c.createdAt,updatedAt:c.createdAt,version:1};
  db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').run(orderId,clientId,JSON.stringify(o));
 }
 const orderCall=await req('/api/oktell-phone',{action:'call',tab,mode:'order',orderId:'own-order'},cookies.irina);
 assert.equal(orderCall.status,200,JSON.stringify(orderCall.data));assert.equal(orderCall.data.destination,'79990000001');
 assert.deepEqual({...db.prepare('SELECT client_id,order_id FROM phone_calls WHERE id=?').get(orderCall.data.callId)},{client_id:'existing-card',order_id:'own-order'});closeCalls();
 for(const orderId of ['foreign-order','missing-order'])assert.equal((await req('/api/oktell-phone',{action:'call',tab,mode:'order',orderId},cookies.irina)).status,403);
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,mode:'order'},cookies.irina)).status,400);
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,mode:'client',clientId:'foreign-card',orderId:'own-order'},cookies.irina)).status,403);
 await req('/api/crm',null,cookies.irina);
 db.prepare('INSERT INTO incoming_calls(id,assignee_id,at,phone,called_number) VALUES(?,?,?,?,?)').run('unknown-incoming',id,c.createdAt,'+79990000099','');
 const incomingCall=await req('/api/oktell-phone',{action:'call',tab,mode:'incoming',incomingId:'unknown-incoming'},cookies.irina);
 assert.equal(incomingCall.status,200,JSON.stringify(incomingCall.data));assert.equal(incomingCall.data.destination,'79990000099');
 assert.equal(db.prepare('SELECT incoming_id FROM phone_call_incoming WHERE call_id=?').get(incomingCall.data.callId).incoming_id,'unknown-incoming');closeCalls();
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,mode:'incoming',incomingId:'missing'},cookies.irina)).status,403);
 // Created after startup: no test-card configuration, migration or per-card setup needed.
 addCard('new-card','+79990000004');
 const choices=await req('/api/telephony?mode=client&clientId=new-card',null,cookies.irina);assert.equal(choices.status,200);assert.equal(choices.data.phones.length,2);assert.equal(choices.data.phones[0].label.includes('79990000004'),false);
 const extra=choices.data.phones[1].key;
 for(const route of ['mts','beeline']){
  const p=route==='mts'?{action:'call',tab,clientId:'new-card',phoneKey:extra}:{mode:'client',clientId:'new-card',phoneKey:extra};const res=await req(route==='mts'?'/api/oktell-phone':'/api/telephony',p,cookies.irina);assert.equal(res.status,200,JSON.stringify(res.data));assert.equal(route==='mts'?res.data.destination:db.prepare('SELECT destination FROM phone_call_targets WHERE call_id=?').get(res.data.callId).destination,'79990000002');closeCalls();
 }
 for(const clientId of ['foreign-card','missing-card']){
  assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId},cookies.irina)).status,403);
  assert.equal((await req('/api/telephony',{mode:'client',clientId},cookies.irina)).status,400);
 }
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId:'new-card',phoneKey:'invalid'},cookies.irina)).status,403);
 db.prepare("UPDATE clients SET data=json_set(data,'$.linkedPhones',json('[]')) WHERE id='new-card'").run();
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId:'new-card',phoneKey:extra},cookies.irina)).status,403);
 assert.equal((await req('/api/telephony',{mode:'client',clientId:'new-card',phoneKey:extra},cookies.irina)).status,400);
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId:'new-card',destination:'79990000999'},cookies.irina)).status,400);
 const racing=await Promise.all([req('/api/oktell-phone',{action:'call',tab,clientId:'new-card'},cookies.irina),req('/api/telephony',{mode:'client',clientId:'existing-card'},cookies.irina)]);assert.equal(racing.filter(r=>r.status===200).length,1);closeCalls();
 assert.equal((await req('/api/oktell-phone',{action:'call',tab:crypto.randomUUID(),clientId:'new-card'},cookies.irina)).status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM phone_calls WHERE ended_at IS NULL').get().n,0);
 // Reassignment applies to both routes immediately.
 db.prepare("UPDATE clients SET data=json_set(data,'$.owner','other') WHERE id='new-card'").run();
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId:'new-card'},cookies.irina)).status,403);
 assert.equal((await req('/api/telephony',{mode:'client',clientId:'new-card'},cookies.irina)).status,400);
 assert.equal((await req('/api/telephony',{mode:'client',clientId:'new-card'},cookies.other)).status,200);closeCalls();
 assert.equal((await req('/api/oktell-phone',{action:'call',tab,clientId:'new-card'},cookies.other)).status,403);
 const mts=await req('/api/oktell-phone',{action:'call',tab,clientId:'test-card'},cookies.irina);assert.equal(mts.status,200);
 call={id:mts.data.callId,status:'connected',answeredAt:'2026-10-27T10:00:00.000Z'};await req('/api/oktell-phone',{action:'heartbeat',tab},cookies.irina);assert.equal(db.prepare('SELECT status FROM phone_calls WHERE id=?').get(mts.data.callId).status,'dialing');assert.equal(db.prepare('SELECT answered_at FROM phone_calls WHERE id=?').get(mts.data.callId).answered_at,null);
 call={id:mts.data.callId,status:'ended',answeredAt:'2026-10-27T10:00:00.000Z',endedAt:'2026-10-27T10:00:20.000Z'};assert.equal((await req('/api/oktell-phone',{action:'heartbeat',tab},cookies.irina)).status,200);assert.equal(db.prepare('SELECT status FROM phone_calls WHERE id=?').get(mts.data.callId).status,'unknown');assert.equal(db.prepare('SELECT answered_at FROM phone_calls WHERE id=?').get(mts.data.callId).answered_at,null);
 assert.equal((await req('/api/oktell-phone',{action:'disconnect',tab},cookies.irina)).status,200);
 const ui=await req('/api/crm',null,cookies.other);assert.equal(ui.status,200,logs);
 console.log('PASS: existing/new cards, both carriers, linked phone selection, ownership and reassignment, no arbitrary destinations, single active call, failed grants, native actor scope, history. No real calls.');
 if(process.env.PREVIEW){db.exec('DELETE FROM phone_calls');writeFileSync('/tmp/oktell-browser-preview.json',JSON.stringify({pid:server.pid,dir}));console.log('Preview ready on 3337');await new Promise(()=>{});}
}finally{server?.kill('SIGTERM');bridge.close();db.close();rmSync(dir,{recursive:true,force:true});}
